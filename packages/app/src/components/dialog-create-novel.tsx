import { Dialog } from "@opencode-ai/ui/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { FieldV2 } from "@opencode-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { createStore } from "solid-js/store"
import { Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"

const API_BASE = "http://127.0.0.1:4177"

type SuggestedProject = {
  id?: string
  title?: string
  genreTags?: string[]
  targetWords?: number
  targetChapters?: number
  config?: {
    language?: string
    targetAudience?: string
    premise?: string
    targetTotalWords?: number
    targetChapters?: number
    creationSeed?: string
  }
}

type CreatedProject = Required<Pick<SuggestedProject, "id" | "title">> & { rootPath?: string }

function asNumber(value: string) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function responseError(response: Response, fallback: string) {
  return response
    .json()
    .then((body) => (typeof body?.message === "string" ? body.message : fallback))
    .catch(() => fallback)
}

export function DialogCreateNovel(props: { onCreated: (project: CreatedProject) => Promise<void> }) {
  const dialog = useDialog()
  const [form, setForm] = createStore({
    idea: "",
    title: "",
    genreTags: "",
    language: "zh-CN",
    targetAudience: "",
    premise: "",
    targetWords: "",
    targetChapters: "",
    id: "",
    loading: false,
    suggested: false,
    created: false,
    error: "",
  })

  function applySuggestion(suggestion: SuggestedProject) {
    const config = suggestion.config ?? {}
    const targetWords = suggestion.targetWords ?? config.targetTotalWords
    const targetChapters = suggestion.targetChapters ?? config.targetChapters
    setForm({
      id: suggestion.id ?? `novel-${Date.now()}`,
      title: suggestion.title ?? form.title,
      genreTags: suggestion.genreTags?.join("，") ?? form.genreTags,
      language: config.language ?? form.language,
      targetAudience: config.targetAudience ?? "",
      premise: config.premise ?? form.idea,
      targetWords: targetWords ? String(targetWords) : form.targetWords,
      targetChapters: targetChapters ? String(targetChapters) : form.targetChapters,
      suggested: true,
      error: "",
    })
  }

  async function suggest() {
    const idea = form.idea.trim()
    if (!idea) {
      setForm("error", "请先填写一句创意。")
      return
    }
    setForm({ loading: true, error: "" })
    try {
      const response = await fetch(`${API_BASE}/api/projects/suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idea,
          ...(form.title.trim() ? { title: form.title.trim() } : {}),
          ...(asNumber(form.targetWords) ? { targetWords: asNumber(form.targetWords) } : {}),
          ...(asNumber(form.targetChapters) ? { targetChapters: asNumber(form.targetChapters) } : {}),
        }),
      })
      if (!response.ok) throw new Error(await responseError(response, "AI 补全失败。"))
      applySuggestion((await response.json()) as SuggestedProject)
    } catch (error) {
      setForm("error", error instanceof Error ? error.message : "AI 补全失败。")
    } finally {
      setForm("loading", false)
    }
  }

  async function create() {
    if (form.created) return
    const title = form.title.trim()
    if (!title) {
      setForm("error", "请填写书名。")
      return
    }
    setForm({ loading: true, error: "" })
    try {
      const response = await fetch(`${API_BASE}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: form.id || `novel-${Date.now()}`,
          title,
          genreTags: form.genreTags
            .split(/[，,]/)
            .map((tag) => tag.trim())
            .filter(Boolean),
          config: {
            language: form.language.trim() || "zh-CN",
            ...(form.targetAudience.trim() ? { targetAudience: form.targetAudience.trim() } : {}),
            ...(form.premise.trim() ? { premise: form.premise.trim() } : {}),
            ...(asNumber(form.targetWords) ? { targetTotalWords: asNumber(form.targetWords) } : {}),
            ...(asNumber(form.targetChapters) ? { targetChapters: asNumber(form.targetChapters) } : {}),
          },
        }),
      })
      if (!response.ok) throw new Error(await responseError(response, "创建小说失败。"))
      const project = (await response.json()) as CreatedProject
      setForm("created", true)
      await props.onCreated(project)
      dialog.close()
    } catch (error) {
      setForm(
        "error",
        form.created
          ? "小说项目已创建，但小说导演会话未能打开。请关闭此窗口后，从首页项目列表打开它。"
          : error instanceof Error
            ? error.message
            : "创建小说失败。",
      )
    } finally {
      setForm("loading", false)
    }
  }

  return (
    <Dialog
      title="创建小说"
      description="先写下一句创意，AI 会生成可继续编辑的项目建议。"
      class="w-full max-w-[620px] mx-auto"
    >
      <div class="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <Show when={!form.suggested}>
            <div class="flex flex-col gap-3">
              <FieldV2 invalid={!!form.error}>
                <FieldV2.Label>一句创意</FieldV2.Label>
                <FieldV2.Control>
                  <TextareaV2
                    autofocus
                    value={form.idea}
                    placeholder="例如：失去记忆的鉴定师，能从旧物里看见它们主人的最后一天。"
                    onInput={(e) => setForm("idea", e.currentTarget.value)}
                  />
                </FieldV2.Control>
              </FieldV2>
              <FieldV2>
                <FieldV2.Label>书名（可选）</FieldV2.Label>
                <FieldV2.Control>
                  <TextInputV2 value={form.title} onInput={(e) => setForm("title", e.currentTarget.value)} />
                </FieldV2.Control>
              </FieldV2>
              <div class="grid grid-cols-2 gap-3">
                <FieldV2>
                  <FieldV2.Label>预计章节（可选）</FieldV2.Label>
                  <FieldV2.Control>
                    <TextInputV2
                      type="number"
                      value={form.targetChapters}
                      onInput={(e) => setForm("targetChapters", e.currentTarget.value)}
                    />
                  </FieldV2.Control>
                </FieldV2>
                <FieldV2>
                  <FieldV2.Label>预计字数（可选）</FieldV2.Label>
                  <FieldV2.Control>
                    <TextInputV2
                      type="number"
                      value={form.targetWords}
                      onInput={(e) => setForm("targetWords", e.currentTarget.value)}
                    />
                  </FieldV2.Control>
                </FieldV2>
              </div>
            </div>
          </Show>
          <Show when={form.suggested}>
            <FieldV2>
              <FieldV2.Label>项目 ID</FieldV2.Label>
              <FieldV2.Control>
                <TextInputV2 value={form.id} onInput={(e) => setForm("id", e.currentTarget.value)} />
              </FieldV2.Control>
            </FieldV2>
            <FieldV2>
              <FieldV2.Label>书名</FieldV2.Label>
              <FieldV2.Control>
                <TextInputV2 value={form.title} onInput={(e) => setForm("title", e.currentTarget.value)} />
              </FieldV2.Control>
            </FieldV2>
            <FieldV2>
              <FieldV2.Label>类型标签</FieldV2.Label>
              <FieldV2.Control>
                <TextInputV2
                  value={form.genreTags}
                  placeholder="例如：都市、异能、悬疑"
                  onInput={(e) => setForm("genreTags", e.currentTarget.value)}
                />
              </FieldV2.Control>
            </FieldV2>
            <FieldV2>
              <FieldV2.Label>故事简介</FieldV2.Label>
              <FieldV2.Control>
                <TextareaV2 value={form.premise} onInput={(e) => setForm("premise", e.currentTarget.value)} />
              </FieldV2.Control>
            </FieldV2>
            <div class="grid grid-cols-2 gap-3">
              <FieldV2>
                <FieldV2.Label>目标读者</FieldV2.Label>
                <FieldV2.Control>
                  <TextInputV2
                    value={form.targetAudience}
                    onInput={(e) => setForm("targetAudience", e.currentTarget.value)}
                  />
                </FieldV2.Control>
              </FieldV2>
              <FieldV2>
                <FieldV2.Label>语言</FieldV2.Label>
                <FieldV2.Control>
                  <TextInputV2 value={form.language} onInput={(e) => setForm("language", e.currentTarget.value)} />
                </FieldV2.Control>
              </FieldV2>
            </div>
            <div class="text-12-regular text-v2-text-text-muted">项目目录：novels/{form.id || "自动生成"}</div>
            <div class="grid grid-cols-2 gap-3">
              <FieldV2>
                <FieldV2.Label>预计章节</FieldV2.Label>
                <FieldV2.Control>
                  <TextInputV2
                    type="number"
                    value={form.targetChapters}
                    onInput={(e) => setForm("targetChapters", e.currentTarget.value)}
                  />
                </FieldV2.Control>
              </FieldV2>
              <FieldV2>
                <FieldV2.Label>预计字数</FieldV2.Label>
                <FieldV2.Control>
                  <TextInputV2
                    type="number"
                    value={form.targetWords}
                    onInput={(e) => setForm("targetWords", e.currentTarget.value)}
                  />
                </FieldV2.Control>
              </FieldV2>
            </div>
          </Show>
          <Show when={form.error}>
            <div class="text-12-regular text-danger-base">{form.error}</div>
          </Show>
        </div>
        <div class="flex shrink-0 justify-end gap-2 pt-4">
          <ButtonV2 variant="ghost" disabled={form.loading} onClick={() => dialog.close()}>
            取消
          </ButtonV2>
          <ButtonV2
            variant="contrast"
            disabled={form.loading || form.created}
            onClick={() => void (form.suggested ? create() : suggest())}
          >
            {form.loading ? "处理中…" : form.created ? "项目已创建" : form.suggested ? "确认创建" : "AI 补全"}
          </ButtonV2>
        </div>
      </div>
    </Dialog>
  )
}
