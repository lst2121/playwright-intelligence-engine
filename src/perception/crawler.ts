import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppModel, AppModelSchema, AppRoute, AppElement } from './app-model.js';

export interface CrawlerOptions {
  baseUrl: string;
  fingerprint?: string;
  maxRoutes?: number;
  maxDepth?: number;
  storageStatePath?: string;
  cacheDir?: string;
  browser?: any;
  page?: any;
}

export function computeCacheKey(baseUrl: string, fingerprint?: string): string {
  const normalized = baseUrl.replace(/\/+$/, '').toLowerCase();
  const raw = `${normalized}::${fingerprint ?? 'default'}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export async function getCachedAppModel(cacheDir: string, baseUrl: string, fingerprint?: string): Promise<AppModel | null> {
  try {
    const key = computeCacheKey(baseUrl, fingerprint);
    const filePath = path.join(cacheDir, `app-model-${key}.json`);
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    const validated = AppModelSchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveCachedAppModel(cacheDir: string, model: AppModel): Promise<void> {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const key = computeCacheKey(model.baseUrl, model.fingerprint);
    const filePath = path.join(cacheDir, `app-model-${key}.json`);
    await fs.writeFile(filePath, JSON.stringify(model, null, 2), 'utf8');
  } catch {
    // Non-fatal if cache cannot be written
  }
}

async function extractFrameSelector(frame: any): Promise<string> {
  try {
    if (typeof frame.name === 'function' && frame.name()) {
      return `iframe[name="${frame.name()}"]`;
    }
    if (typeof frame.frameElement === 'function') {
      const handle = await frame.frameElement();
      if (handle) {
        const selector = await handle.evaluate((el: any) => {
          const title = el.getAttribute('title');
          if (title) return `iframe[title="${title}"]`;
          const name = el.getAttribute('name');
          if (name) return `iframe[name="${name}"]`;
          const id = el.getAttribute('id');
          if (id) return `iframe#${id}`;
          const src = el.getAttribute('src');
          if (src) return `iframe[src="${src}"]`;
          return 'iframe';
        });
        if (selector) return selector;
      }
    }
  } catch {
    // Fallback if frame element lookup fails
  }
  return 'iframe';
}

async function collectFrameElements(frameHandle: any, frameSelector?: string): Promise<AppElement[]> {
  try {
    const raw = await frameHandle.$$eval('button, a, input, select, textarea, [role="button"], [role="textbox"], [role="status"], heading, h1, h2, h3', (nodes: any[]) => {
      return nodes.map((el) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || (tag === 'button' ? 'button' : tag === 'input' ? 'textbox' : undefined);
        const accessibleName = el.getAttribute('aria-label') || el.innerText?.trim() || el.getAttribute('placeholder') || undefined;
        const label = el.getAttribute('aria-label') || el.getAttribute('name') || undefined;
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || undefined;
        const visible = Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return { tag, role, accessibleName, label, testId, visible };
      });
    });

    const elements: AppElement[] = raw.map((item: any) => ({
      tag: item.tag,
      role: item.role,
      accessibleName: item.accessibleName,
      label: item.label,
      testId: item.testId,
      frameSelector,
      count: 1,
      visible: item.visible,
    }));
    return elements;
  } catch {
    if (frameSelector) {
      return [{
        tag: 'iframe',
        role: 'cross-origin-unavailable',
        frameSelector,
        count: 1,
        visible: true,
      }];
    }
    return [];
  }
}

export class AppCrawler {
  public static async crawl(options: CrawlerOptions): Promise<AppModel> {
    const cacheDir = options.cacheDir ?? path.join(process.cwd(), '.pie', 'cache');
    const fingerprint = options.fingerprint ?? 'default';

    // 1. Check cache
    const cached = await getCachedAppModel(cacheDir, options.baseUrl, fingerprint);
    if (cached) {
      return cached;
    }

    const maxRoutes = options.maxRoutes ?? 20;
    const maxDepth = options.maxDepth ?? 2;
    const baseHost = new URL(options.baseUrl).host;

    const routes: AppRoute[] = [];
    let browserToClose: any = null;

    try {
      let page = options.page;
      if (!page) {
        if (options.browser) {
          const context = await options.browser.newContext({
            storageState: options.storageStatePath,
          });
          page = await context.newPage();
        } else {
          // Attempt dynamic import of playwright
          try {
            const { chromium } = await import('@playwright/test');
            browserToClose = await chromium.launch({ headless: true });
            const context = await browserToClose.newContext({
              storageState: options.storageStatePath,
            });
            page = await context.newPage();
          } catch {
            // If browser cannot be launched, return minimal bounded model
            const fallbackModel: AppModel = {
              version: '1',
              baseUrl: options.baseUrl,
              fingerprint,
              capturedAt: new Date().toISOString(),
              routes: [{ route: '/', elements: [] }],
            };
            return fallbackModel;
          }
        }
      }

      const queue: Array<{ url: string; depth: number }> = [{ url: options.baseUrl, depth: 0 }];
      const visited = new Set<string>();

      while (queue.length > 0 && routes.length < maxRoutes) {
        const item = queue.shift()!;
        if (visited.has(item.url)) continue;
        visited.add(item.url);

        try {
          await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        } catch {
          continue;
        }

        const elements: AppElement[] = [];

        // Main frame elements
        const mainElements = await collectFrameElements(page, undefined);
        elements.push(...mainElements);

        // Child frame elements
        if (typeof page.frames === 'function') {
          const childFrames = page.frames().slice(1);
          for (const childFrame of childFrames) {
            const frameSelector = await extractFrameSelector(childFrame);
            const childElements = await collectFrameElements(childFrame, frameSelector);
            elements.push(...childElements);
          }
        }

        const urlObj = new URL(item.url);
        routes.push({
          route: urlObj.pathname || '/',
          title: typeof page.title === 'function' ? await page.title().catch(() => undefined) : undefined,
          elements,
        });

        // Bounded exploration: collect links without clicking destructive elements
        if (item.depth < maxDepth && routes.length < maxRoutes) {
          try {
            const hrefs: string[] = await page.$$eval('a[href]', (anchors: any[]) =>
              anchors.map((a) => a.getAttribute('href')).filter(Boolean),
            );
            for (const href of hrefs) {
              try {
                const resolved = new URL(href, item.url);
                // Allowlisted host only, no logout/delete/submit paths
                if (resolved.host === baseHost && !/logout|signout|delete|destroy/i.test(resolved.pathname)) {
                  const cleaned = resolved.origin + resolved.pathname;
                  if (!visited.has(cleaned) && !queue.some((q) => q.url === cleaned)) {
                    queue.push({ url: cleaned, depth: item.depth + 1 });
                  }
                }
              } catch {
                // Ignore invalid URLs
              }
            }
          } catch {
            // Ignore link evaluation failure
          }
        }
      }
    } catch {
      // Bounded fallback
    } finally {
      if (browserToClose) {
        await browserToClose.close().catch(() => {});
      }
    }

    const model: AppModel = {
      version: '1',
      baseUrl: options.baseUrl,
      fingerprint,
      capturedAt: new Date().toISOString(),
      routes: routes.length > 0 ? routes : [{ route: '/', elements: [] }],
    };

    await saveCachedAppModel(cacheDir, model);
    return model;
  }
}
