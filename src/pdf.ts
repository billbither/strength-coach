import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function pdfToText(pdf: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "coach-pdf-"));
  const file = join(dir, "doc.pdf");
  try {
    await writeFile(file, pdf);
    const { stdout } = await run("pdftotext", ["-layout", file, "-"]);
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
