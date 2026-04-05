import { clearSourceCache } from '../src/source-adapters.mjs';
import { listTrends, searchCatalog } from '../src/search-service.mjs';

clearSourceCache();
for (const topic of listTrends().slice(0, 6)) {
  const result = await searchCatalog({ q: topic, live: true, forceRefresh: true });
  console.log(topic, result.total, result.liveSourceCount, result.canonicalCount);
}
