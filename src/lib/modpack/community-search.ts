export interface CommunityReport {
  source: "GitHub" | "Reddit" | "Web";
  title: string;
  url: string;
  snippet: string;
  isConfirmedFix?: boolean;
}

export interface CommunitySearchResult {
  modId: string;
  queryUsed: string;
  reports: CommunityReport[];
}

interface GitHubIssueItem {
  title?: unknown;
  html_url?: unknown;
  body?: unknown;
  state?: unknown;
  labels?: unknown;
}

interface RedditPostData {
  title?: unknown;
  permalink?: unknown;
  selftext?: unknown;
}

const USER_AGENT = "ModpackInspectorApp/1.0";
const SNIPPET_LENGTH = 180;

export async function searchCommunityReports(
  modName: string,
  errorSnippet?: string,
): Promise<CommunitySearchResult> {
  const cleanModName = modName.replace(/[-_]/g, " ").trim();
  const searchTerms = `${cleanModName} 1.21.1 ${errorSnippet?.trim() || "crash"}`;
  const reports: CommunityReport[] = [];

  await searchGitHub(cleanModName, reports);
  await searchReddit(cleanModName, reports);

  return {
    modId: modName,
    queryUsed: searchTerms,
    reports,
  };
}

async function searchGitHub(
  modName: string,
  reports: CommunityReport[],
): Promise<void> {
  try {
    const githubQuery = encodeURIComponent(
      `${modName} 1.21.1 in:title,body label:bug,crash`,
    );
    const response = await fetch(
      `https://api.github.com/search/issues?q=${githubQuery}&per_page=4`,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/vnd.github.v3+json",
        },
        next: { revalidate: 3600 },
      },
    );

    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as { items?: GitHubIssueItem[] };
    for (const item of data.items ?? []) {
      const title = asNonEmptyString(item.title);
      const url = asNonEmptyString(item.html_url);
      if (!title || !url) {
        continue;
      }

      const labels = Array.isArray(item.labels)
        ? item.labels
            .map((label) => {
              if (!label || typeof label !== "object") {
                return "";
              }
              const name = (label as { name?: unknown }).name;
              return typeof name === "string" ? name.toLowerCase() : "";
            })
            .filter(Boolean)
        : [];
      const body = asNonEmptyString(item.body);

      reports.push({
        source: "GitHub",
        title,
        url,
        snippet: truncate(body || "Relato em Issue do GitHub."),
        isConfirmedFix: item.state === "closed" || labels.some((label) => label.includes("fixed")),
      });
    }
  } catch (error) {
    console.error(`[CommunitySearch] Erro ao consultar GitHub para ${modName}:`, error);
  }
}

async function searchReddit(
  modName: string,
  reports: CommunityReport[],
): Promise<void> {
  try {
    const redditQuery = encodeURIComponent(`${modName} 1.21.1 crash OR issue`);
    const response = await fetch(
      `https://www.reddit.com/search.json?q=${redditQuery}&limit=3&sort=relevance`,
      {
        headers: { "User-Agent": USER_AGENT },
        next: { revalidate: 3600 },
      },
    );

    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as {
      data?: { children?: Array<{ data?: RedditPostData }> };
    };
    for (const post of data.data?.children ?? []) {
      const postData = post.data;
      const title = asNonEmptyString(postData?.title);
      const permalink = asNonEmptyString(postData?.permalink);
      if (!title || !permalink) {
        continue;
      }

      reports.push({
        source: "Reddit",
        title,
        url: `https://reddit.com${permalink}`,
        snippet: truncate(
          asNonEmptyString(postData?.selftext) || "Discussão na comunidade do Reddit.",
        ),
      });
    }
  } catch (error) {
    console.error(`[CommunitySearch] Erro ao consultar Reddit para ${modName}:`, error);
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncate(value: string): string {
  return value.length > SNIPPET_LENGTH
    ? `${value.slice(0, SNIPPET_LENGTH)}...`
    : value;
}
