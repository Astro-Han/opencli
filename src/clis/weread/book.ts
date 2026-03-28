import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { fetchPrivateApi, resolveShelfReaderUrl } from './utils.js';

interface ReaderFallbackResult {
  title: string;
  author: string;
  publisher: string;
  intro: string;
  category: string;
  rating: string;
  metadataReady: boolean;
}

/**
 * Read visible book metadata from the web reader cover/flyleaf page.
 * This path is used as a fallback when the private API session has expired.
 */
async function loadReaderFallbackResult(page: IPage, readerUrl: string): Promise<ReaderFallbackResult> {
  await page.goto(readerUrl);
  await page.wait({ selector: '.horizontalReaderCoverPage_content_bookTitle, .wr_flyleaf_page_bookInfo_bookTitle', timeout: 10 });

  const result = await page.evaluate(`
    (() => {
      const text = (node) => node?.textContent?.trim() || '';
      const bodyText = document.body?.innerText?.replace(/\\s+/g, ' ').trim() || '';
      const titleSelector = '.horizontalReaderCoverPage_content_bookTitle, .wr_flyleaf_page_bookInfo_bookTitle';
      const authorSelector = '.horizontalReaderCoverPage_content_author, .wr_flyleaf_page_bookInfo_author';
      const extractRating = () => {
        const match = bodyText.match(/微信读书推荐值\\s*([0-9.]+%)/);
        return match ? match[1] : '';
      };
      const extractPublisher = () => {
        const direct = text(document.querySelector('.introDialog_content_pub_line'));
        return direct.startsWith('出版社') ? direct.replace(/^出版社\\s*/, '').trim() : '';
      };
      const extractIntro = () => {
        const selectors = [
          '.horizontalReaderCoverPage_content_bookInfo_intro',
          '.wr_flyleaf_page_bookIntro_content',
          '.introDialog_content_intro_para',
        ];
        for (const selector of selectors) {
          const value = text(document.querySelector(selector));
          if (value) return value;
        }
        return '';
      };

      const categorySource = Array.from(document.scripts)
        .map((script) => script.textContent || '')
        .find((scriptText) => scriptText.includes('"category"')) || '';
      const categoryMatch = categorySource.match(/"category"\\s*:\\s*"([^"]+)"/);
      const title = text(document.querySelector(titleSelector));
      const author = text(document.querySelector(authorSelector));

      return {
        title,
        author,
        publisher: extractPublisher(),
        intro: extractIntro(),
        category: categoryMatch ? categoryMatch[1].trim() : '',
        rating: extractRating(),
        metadataReady: Boolean(title || author),
      };
    })()
  `) as Partial<ReaderFallbackResult>;

  return {
    title: String(result?.title || '').trim(),
    author: String(result?.author || '').trim(),
    publisher: String(result?.publisher || '').trim(),
    intro: String(result?.intro || '').trim(),
    category: String(result?.category || '').trim(),
    rating: String(result?.rating || '').trim(),
    metadataReady: result?.metadataReady === true,
  };
}

cli({
  site: 'weread',
  name: 'book',
  description: 'View book details on WeRead',
  domain: 'weread.qq.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'book-id', positional: true, required: true, help: 'Book ID from search or shelf results' },
  ],
  columns: ['title', 'author', 'publisher', 'intro', 'category', 'rating'],
  func: async (page: IPage, args) => {
    const bookId = String(args['book-id'] || '').trim();

    try {
      const data = await fetchPrivateApi(page, '/book/info', { bookId });
      // newRating is 0-1000 scale per community docs; needs runtime verification
      const rating = data.newRating ? `${(data.newRating / 10).toFixed(1)}%` : '-';
      return [{
        title: data.title ?? '',
        author: data.author ?? '',
        publisher: data.publisher ?? '',
        intro: data.intro ?? '',
        category: data.category ?? '',
        rating,
      }];
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== 'AUTH_REQUIRED') {
        throw error;
      }

      const readerUrl = await resolveShelfReaderUrl(page, bookId);
      if (!readerUrl) {
        throw error;
      }

      const data = await loadReaderFallbackResult(page, readerUrl);
      if (!data.metadataReady || !data.title) {
        throw error;
      }

      return [{
        title: data.title,
        author: data.author,
        publisher: data.publisher,
        intro: data.intro,
        category: data.category,
        rating: data.rating,
      }];
    }
  },
});
