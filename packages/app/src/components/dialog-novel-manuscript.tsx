import { Dialog } from "@opencode-ai/ui/dialog"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { createResource, For, Show } from "solid-js"
import { loadNovelChapters, type NovelChapter, type NovelManuscriptClient } from "@/pages/home-novel-manuscript"

export function DialogNovelManuscript(props: {
  title: string
  directory: string
  client: NovelManuscriptClient
  onSelect: (chapter: NovelChapter) => void
}) {
  const [chapters] = createResource(() => loadNovelChapters(props.client, props.directory))

  return (
    <Dialog title={`${props.title} · 正文`} class="w-full max-w-[560px] mx-auto">
      <div class="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <Show
          when={!chapters.loading && chapters()?.length}
          fallback={
            <div class="flex min-h-32 items-center justify-center px-4 text-13-regular text-text-weak">
              {chapters.loading ? "正在读取章节…" : "还没有可阅读的章节，请先生成并保存正文。"}
            </div>
          }
        >
          <ScrollView class="max-h-[min(560px,70vh)]">
            <div class="flex flex-col gap-1">
              <For each={chapters()}>
                {(chapter) => (
                  <button
                    type="button"
                    class="rounded-md border-0 bg-transparent px-4 py-3 text-left hover:bg-surface-base-hover"
                    onClick={() => props.onSelect(chapter)}
                  >
                    <div class="text-13-medium text-text-strong">第{chapter.chapterNo}章　{chapter.title}</div>
                    <div class="mt-1 truncate text-11-regular text-text-weak">{chapter.sourcePath}</div>
                  </button>
                )}
              </For>
            </div>
          </ScrollView>
        </Show>
      </div>
    </Dialog>
  )
}
