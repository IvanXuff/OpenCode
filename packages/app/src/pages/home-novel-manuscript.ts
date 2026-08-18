type ChapterIndexFile = {
  chapterIndex?: unknown
}

type ChapterIndexEntry = {
  chapterNo?: unknown
  title?: unknown
  sourcePath?: unknown
}

export type NovelChapter = {
  chapterNo: number
  title: string
  sourcePath: string
}

export type NovelManuscriptClient = {
  file: {
    read(input: { directory: string; path: string }): Promise<{ data?: { type: string; content: string } }>
  }
}

export function manuscriptPath(value: unknown) {
  if (typeof value !== "string") return
  const path = value.trim().replaceAll("\\", "/")
  if (!path || /^(?:[A-Za-z]:|\/)/.test(path)) return
  if (path.split("/").some((part) => !part || part === "." || part === "..")) return
  if (!path.startsWith("manuscript/") || !path.toLowerCase().endsWith(".md")) return
  return path
}

export function parseNovelChapterIndex(content: string): NovelChapter[] {
  let index: ChapterIndexFile
  try {
    index = JSON.parse(content) as ChapterIndexFile
  } catch {
    return []
  }
  if (!Array.isArray(index.chapterIndex)) return []

  return index.chapterIndex
    .flatMap((value) => {
      if (!value || typeof value !== "object") return []
      const entry = value as ChapterIndexEntry
      const chapterNo = typeof entry.chapterNo === "number" ? entry.chapterNo : Number.NaN
      const title = typeof entry.title === "string" ? entry.title.trim() : ""
      const sourcePath = manuscriptPath(entry.sourcePath)
      if (!Number.isInteger(chapterNo) || chapterNo < 1 || !title || !sourcePath) return []
      return [{ chapterNo, title, sourcePath }]
    })
    .sort((a, b) => a.chapterNo - b.chapterNo)
}

export async function loadNovelChapters(client: NovelManuscriptClient, directory: string) {
  const file = await client.file
    .read({ directory, path: "state/context-index.json" })
    .then((result) => result.data, () => undefined)
  if (file?.type !== "text") return []
  return parseNovelChapterIndex(file.content)
}

export async function loadNovelChapter(client: NovelManuscriptClient, directory: string, chapter: NovelChapter) {
  const path = manuscriptPath(chapter.sourcePath)
  if (!path) return
  const file = await client.file.read({ directory, path }).then((result) => result.data, () => undefined)
  if (file?.type !== "text" || !file.content.trim()) return
  return file.content
}

type ManuscriptSession = {
  id: string
  parentID?: string
  time?: { updated?: number; created?: number; archived?: number }
}

type NovelSessionClient = {
  session: {
    list(input: { directory: string; roots: true; limit: number }): Promise<{ data?: ManuscriptSession[] }>
    create(input: { directory: string; title: string }): Promise<{ data?: ManuscriptSession }>
  }
}

export async function manuscriptSession(client: NovelSessionClient, directory: string) {
  const sessions = await client.session
    .list({ directory, roots: true, limit: 64 })
    .then((result) => result.data ?? [], () => [])
  const existing = sessions
    .filter((session) => !session.parentID && !session.time?.archived)
    .sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0))[0]
  if (existing) return existing
  return client.session
    .create({ directory, title: "小说正文阅读" })
    .then((result) => result.data, () => undefined)
}
