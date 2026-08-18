import { pathKey } from "@/utils/path-key"

type ProjectFile = {
  title?: unknown
  rootPath?: unknown
  status?: unknown
  draft?: unknown
  isDraft?: unknown
}

type NovelDirectory = {
  absolute: string
  type: "file" | "directory"
}

type NovelProjectClient = {
  file: {
    list(input: { directory: string; path: string }): Promise<{ data?: NovelDirectory[] }>
    read(input: { directory: string; path: string }): Promise<{ data?: { type: string; content: string } }>
  }
}

type CurrentProjectClient = {
  project: {
    current(): Promise<{ data?: { worktree?: unknown } }>
  }
}

export type DiscoveredNovelProject = {
  directory: string
  title: string
}

export async function currentProjectDirectory(client: CurrentProjectClient) {
  const result = await client.project.current().then((result) => result.data, () => undefined)
  return typeof result?.worktree === "string" && result.worktree.trim() ? result.worktree : undefined
}

export async function restoreNovelProjects(
  client: NovelProjectClient & CurrentProjectClient,
  open: (directory: string, title?: string) => void,
) {
  const root = await currentProjectDirectory(client)
  if (!root) return
  open(root)
  const novels = await discoverNovelProjects(client, root)
  if (!novels) return
  for (const novel of novels) open(novel.directory, novel.title)
  return root
}

const absolutePath = (value: string) => /^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)

const normalizePath = (value: string) => pathKey(value.replaceAll("\\", "/"))

const withinRoot = (root: string, value: string) => {
  const base = normalizePath(root).toLowerCase()
  const candidate = normalizePath(value).toLowerCase()
  return candidate === base || candidate.startsWith(`${base}/`)
}

const projectRoot = (root: string, value: string) => {
  const path = value.replaceAll("\\", "/")
  if (path.split("/").some((part) => part === "..")) return
  const resolved = normalizePath(absolutePath(path) ? path : `${root}/${path}`)
  if (!withinRoot(root, resolved)) return
  return resolved
}

export function parseNovelProject(root: string, directory: string, content: string): DiscoveredNovelProject | undefined {
  let project: ProjectFile
  try {
    project = JSON.parse(content) as ProjectFile
  } catch {
    return
  }

  if (project.status === "draft" || project.draft === true || project.isDraft === true) return
  if (typeof project.title !== "string" || !project.title.trim()) return
  if (typeof project.rootPath !== "string" || !project.rootPath.trim()) return
  if (projectRoot(root, project.rootPath) !== pathKey(directory)) return
  return { directory, title: project.title.trim() }
}

export async function discoverNovelProjects(client: NovelProjectClient, root: string) {
  const entries = await client.file.list({ directory: root, path: "novels" }).then((result) => result.data, () => undefined)
  if (!entries) return
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.type === "directory")
      .map(async (entry) => {
        const file = await client.file.read({ directory: entry.absolute, path: "project.json" }).then((result) => result.data, () => undefined)
        if (file?.type !== "text") return
        return parseNovelProject(root, entry.absolute, file.content)
      }),
  )
  return projects.filter((project): project is DiscoveredNovelProject => !!project)
}
