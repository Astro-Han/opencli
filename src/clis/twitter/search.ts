import { cli, Strategy } from '../../registry.js';

cli({
  site: 'twitter',
  name: 'search',
  description: 'Search Twitter/X for tweets',
  domain: 'x.com',
  strategy: Strategy.INTERCEPT, // Use intercept strategy
  browser: true,
  args: [
    { name: 'query', type: 'string', required: true },
    { name: 'limit', type: 'int', default: 15 },
  ],
  columns: ['id', 'author', 'text', 'likes', 'views', 'url'],
  func: async (page, kwargs) => {
    const query = kwargs.query;

    // 1. Navigate to x.com/explore (has a search input at the top)
    await page.goto('https://x.com/explore');
    await page.wait(3);

    // 2. Install interceptor BEFORE triggering search.
    //    SPA navigation preserves the JS context, so the monkey-patched
    //    fetch will capture the SearchTimeline API call.
    await page.installInterceptor('SearchTimeline');

    // 3. Use the search input to submit the query (SPA, no full reload).
    //    Find the search input, type the query, and submit.
    await page.evaluate(`
      (() => {
        const input = document.querySelector('input[data-testid="SearchBox_Search_Input"]');
        if (!input) throw new Error('Search input not found');
        input.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(input, ${JSON.stringify(query)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await page.wait(0.5);
    // Press Enter to submit
    await page.evaluate(`
      (() => {
        const input = document.querySelector('input[data-testid="SearchBox_Search_Input"]');
        if (!input) throw new Error('Search input not found');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      })()
    `);
    await page.wait(5);

    // 4. Click "Top" tab if available (ensures we get top results)
    try {
      await page.evaluate(`
        (() => {
          const tabs = document.querySelectorAll('[role="tab"]');
          for (const tab of tabs) {
            if (tab.textContent.trim() === 'Top') { tab.click(); break; }
          }
        })()
      `);
      await page.wait(2);
    } catch { /* ignore if tab not found */ }

    // 5. Scroll to trigger additional pagination
    await page.autoScroll({ times: 2, delayMs: 2000 });

    // 6. Retrieve captured data
    const requests = await page.getInterceptedRequests();
    if (!requests || requests.length === 0) return [];

    let results: any[] = [];
    const seen = new Set<string>();
    for (const req of requests) {
      try {
        const insts = req?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
        const addEntries = insts.find((i: any) => i.type === 'TimelineAddEntries')
          || insts.find((i: any) => i.entries && Array.isArray(i.entries));
        if (!addEntries?.entries) continue;

        for (const entry of addEntries.entries) {
          if (!entry.entryId.startsWith('tweet-')) continue;
          
          let tweet = entry.content?.itemContent?.tweet_results?.result;
          if (!tweet) continue;

          // Handle retweet wrapping
          if (tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
              tweet = tweet.tweet;
          }
          if (!tweet.rest_id || seen.has(tweet.rest_id)) continue;
          seen.add(tweet.rest_id);

          // Twitter moved screen_name from legacy to core
          const tweetUser = tweet.core?.user_results?.result;
          results.push({
            id: tweet.rest_id,
            author: tweetUser?.core?.screen_name || tweetUser?.legacy?.screen_name || 'unknown',
            text: tweet.note_tweet?.note_tweet_results?.result?.text || tweet.legacy?.full_text || '',
            likes: tweet.legacy?.favorite_count || 0,
            views: tweet.views?.count || '0',
            url: `https://x.com/i/status/${tweet.rest_id}`
          });
        }
      } catch (e) {
        // ignore parsing errors for individual payloads
      }
    }

    return results.slice(0, kwargs.limit);
  }
});
