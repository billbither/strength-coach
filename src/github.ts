function headers() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "strength-coach-agent",
  };
}

const api = (repo: string, path: string) => `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;

export async function readRepoFile(repo: string, path: string): Promise<{ content: string; sha: string }> {
  const res = await fetch(api(repo, path), { headers: headers() });
  if (!res.ok) throw new Error(`GitHub read ${repo}/${path} failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { content: string; sha: string };
  return { content: Buffer.from(json.content, "base64").toString("utf8"), sha: json.sha };
}

export async function writeRepoFile(
  repo: string,
  path: string,
  content: string,
  sha: string | undefined,
  message: string,
): Promise<void> {
  const put = (useSha: string | undefined) =>
    fetch(api(repo, path), {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(useSha ? { sha: useSha } : {}),
      }),
    });
  let res = await put(sha);
  // 409/422 = the file changed under us (concurrent write). Re-read the current SHA and retry once.
  if ((res.status === 409 || res.status === 422) && sha) {
    let fresh: string | undefined;
    try {
      fresh = (await readRepoFile(repo, path)).sha;
    } catch {
      fresh = undefined;
    }
    res = await put(fresh);
  }
  if (!res.ok) throw new Error(`GitHub write ${repo}/${path} failed: ${res.status} ${await res.text()}`);
}

export async function appendRepoFile(repo: string, path: string, lines: string[], message: string): Promise<void> {
  // Re-read + re-append on each attempt so a concurrent append is never clobbered
  // (unlike a full-file overwrite, an append's payload depends on the current content).
  for (let attempt = 0; attempt < 3; attempt++) {
    const { content, sha } = await readRepoFile(repo, path);
    const base = content.endsWith("\n") || content.length === 0 ? content : content + "\n";
    const res = await fetch(api(repo, path), {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: Buffer.from(base + lines.join("\n") + "\n", "utf8").toString("base64"),
        sha,
      }),
    });
    if (res.ok) return;
    if ((res.status === 409 || res.status === 422) && attempt < 2) continue; // someone else wrote; rebuild
    throw new Error(`GitHub append ${repo}/${path} failed: ${res.status} ${await res.text()}`);
  }
}
