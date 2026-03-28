import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../../errors.js';

const { mockFetchPrivateApi } = vi.hoisted(() => ({
  mockFetchPrivateApi: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    fetchPrivateApi: mockFetchPrivateApi,
  };
});

import { getRegistry } from '../../registry.js';
import './book.js';
import './highlights.js';
import './notes.js';

describe('weread book-id positional args', () => {
  const book = getRegistry().get('weread/book');
  const highlights = getRegistry().get('weread/highlights');
  const notes = getRegistry().get('weread/notes');

  beforeEach(() => {
    mockFetchPrivateApi.mockReset();
  });

  it('passes the positional book-id to book details', async () => {
    mockFetchPrivateApi.mockResolvedValue({ title: 'Three Body', newRating: 880 });

    await book!.func!({} as any, { 'book-id': '12345' });

    expect(mockFetchPrivateApi).toHaveBeenCalledWith({}, '/book/info', { bookId: '12345' });
  });

  it('falls back to the shelf reader page when private API auth has expired', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce({
          cacheFound: true,
          rawBooks: [
            { bookId: 'MP_WXS_3634777637', title: '文明、现代化、价值投资与中国', author: '李录' },
          ],
          shelfIndexes: [
            { bookId: 'MP_WXS_3634777637', idx: 0, role: 'book' },
          ],
        })
        .mockResolvedValueOnce(['https://weread.qq.com/web/reader/6f5323f071bd7f7b6f521e8'])
        .mockResolvedValueOnce({
          title: '文明、现代化、价值投资与中国',
          author: '李录',
          publisher: '中信出版集团',
          intro: '对中国未来几十年的预测。',
          category: '',
          rating: '84.1%',
          metadataReady: true,
        }),
      getCookies: vi.fn().mockResolvedValue([
        { name: 'wr_vid', value: '70486028', domain: '.weread.qq.com' },
      ]),
      wait: vi.fn().mockResolvedValue(undefined),
    } as any;

    const result = await book!.func!(page, { 'book-id': 'MP_WXS_3634777637' });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/shelf');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://weread.qq.com/web/reader/6f5323f071bd7f7b6f521e8');
    expect(page.evaluate).toHaveBeenCalledTimes(3);
    expect(result).toEqual([
      {
        title: '文明、现代化、价值投资与中国',
        author: '李录',
        publisher: '中信出版集团',
        intro: '对中国未来几十年的预测。',
        category: '',
        rating: '84.1%',
      },
    ]);
  });

  it('keeps mixed shelf entries aligned when resolving MP_WXS reader urls', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce({
          cacheFound: true,
          rawBooks: [
            { bookId: 'MP_WXS_1', title: '公众号文章一', author: '作者甲' },
            { bookId: 'BOOK_2', title: '普通书二', author: '作者乙' },
            { bookId: 'MP_WXS_3', title: '公众号文章三', author: '作者丙' },
          ],
          shelfIndexes: [
            { bookId: 'MP_WXS_1', idx: 0, role: 'mp' },
            { bookId: 'BOOK_2', idx: 1, role: 'book' },
            { bookId: 'MP_WXS_3', idx: 2, role: 'mp' },
          ],
        })
        .mockResolvedValueOnce([
          'https://weread.qq.com/web/reader/mp1',
          'https://weread.qq.com/web/reader/book2',
          'https://weread.qq.com/web/reader/mp3',
        ])
        .mockResolvedValueOnce({
          title: '公众号文章一',
          author: '作者甲',
          publisher: '微信读书',
          intro: '第一篇文章。',
          category: '',
          rating: '',
          metadataReady: true,
        }),
      getCookies: vi.fn().mockResolvedValue([
        { name: 'wr_vid', value: '70486028', domain: '.weread.qq.com' },
      ]),
      wait: vi.fn().mockResolvedValue(undefined),
    } as any;

    const result = await book!.func!(page, { 'book-id': 'MP_WXS_1' });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/shelf');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://weread.qq.com/web/reader/mp1');
    expect(result).toEqual([
      {
        title: '公众号文章一',
        author: '作者甲',
        publisher: '微信读书',
        intro: '第一篇文章。',
        category: '',
        rating: '',
      },
    ]);
  });

  it('rethrows AUTH_REQUIRED when shelf ordering is incomplete and reader urls cannot be trusted', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce({
          cacheFound: true,
          rawBooks: [
            { bookId: 'BOOK_1', title: '第一本', author: '作者甲' },
            { bookId: 'BOOK_2', title: '第二本', author: '作者乙' },
          ],
          shelfIndexes: [
            { bookId: 'BOOK_2', idx: 0, role: 'book' },
          ],
        })
        .mockResolvedValueOnce([
          'https://weread.qq.com/web/reader/book2',
          'https://weread.qq.com/web/reader/book1',
        ]),
      getCookies: vi.fn().mockResolvedValue([
        { name: 'wr_vid', value: '70486028', domain: '.weread.qq.com' },
      ]),
      wait: vi.fn().mockResolvedValue(undefined),
    } as any;

    await expect(book!.func!(page, { 'book-id': 'BOOK_1' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      message: 'Not logged in to WeRead',
    });
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith('https://weread.qq.com/web/shelf');
  });

  it('waits for shelf indexes to hydrate before resolving a trusted reader url', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce({
          cacheFound: true,
          rawBooks: [
            { bookId: 'BOOK_1', title: '第一本', author: '作者甲' },
            { bookId: 'BOOK_2', title: '第二本', author: '作者乙' },
          ],
          shelfIndexes: [
            { bookId: 'BOOK_2', idx: 0, role: 'book' },
          ],
        })
        .mockResolvedValueOnce({
          cacheFound: true,
          rawBooks: [
            { bookId: 'BOOK_1', title: '第一本', author: '作者甲' },
            { bookId: 'BOOK_2', title: '第二本', author: '作者乙' },
          ],
          shelfIndexes: [
            { bookId: 'BOOK_2', idx: 0, role: 'book' },
            { bookId: 'BOOK_1', idx: 1, role: 'book' },
          ],
        })
        .mockResolvedValueOnce([
          'https://weread.qq.com/web/reader/book2',
          'https://weread.qq.com/web/reader/book1',
        ])
        .mockResolvedValueOnce({
          title: '第一本',
          author: '作者甲',
          publisher: '出版社甲',
          intro: '简介甲',
          category: '',
          rating: '',
          metadataReady: true,
        }),
      getCookies: vi.fn().mockResolvedValue([
        { name: 'wr_vid', value: '70486028', domain: '.weread.qq.com' },
      ]),
      wait: vi.fn().mockResolvedValue(undefined),
    } as any;

    const result = await book!.func!(page, { 'book-id': 'BOOK_1' });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/shelf');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://weread.qq.com/web/reader/book1');
    expect(result).toEqual([
      {
        title: '第一本',
        author: '作者甲',
        publisher: '出版社甲',
        intro: '简介甲',
        category: '',
        rating: '',
      },
    ]);
  });

  it('rethrows AUTH_REQUIRED when the reader page lacks stable cover metadata', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce({
          cacheFound: true,
          rawBooks: [
            { bookId: 'BOOK_1', title: '第一本', author: '作者甲' },
          ],
          shelfIndexes: [
            { bookId: 'BOOK_1', idx: 0, role: 'book' },
          ],
        })
        .mockResolvedValueOnce([
          'https://weread.qq.com/web/reader/book1',
        ])
        .mockResolvedValueOnce({
          title: '',
          author: '',
          publisher: '',
          intro: '这是正文第一段，不应该被当成简介。',
          category: '',
          rating: '',
          metadataReady: false,
        }),
      getCookies: vi.fn().mockResolvedValue([
        { name: 'wr_vid', value: '70486028', domain: '.weread.qq.com' },
      ]),
      wait: vi.fn().mockResolvedValue(undefined),
    } as any;

    await expect(book!.func!(page, { 'book-id': 'BOOK_1' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      message: 'Not logged in to WeRead',
    });
  });

  it('passes the positional book-id to highlights', async () => {
    mockFetchPrivateApi.mockResolvedValue({ updated: [] });

    await highlights!.func!({} as any, { 'book-id': 'abc', limit: 5 });

    expect(mockFetchPrivateApi).toHaveBeenCalledWith({}, '/book/bookmarklist', { bookId: 'abc' });
  });

  it('passes the positional book-id to notes', async () => {
    mockFetchPrivateApi.mockResolvedValue({ reviews: [] });

    await notes!.func!({} as any, { 'book-id': 'xyz', limit: 5 });

    expect(mockFetchPrivateApi).toHaveBeenCalledWith({}, '/review/list', {
      bookId: 'xyz',
      listType: '11',
      mine: '1',
      synckey: '0',
    });
  });
});
