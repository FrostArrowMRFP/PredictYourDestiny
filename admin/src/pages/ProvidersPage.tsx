import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Bot, Trash2, Edit, Check, Star, Activity, ListPlus, Search } from 'lucide-react'
import { apiRequest } from '../api/client'
import { PageHeader, EmptyState, LoadingState } from '../components/PageHeader'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import { Label } from '../components/ui/Label'
import { Badge } from '../components/ui/Badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/Dialog'

interface Provider {
  id: number
  name: string
  baseUrl: string
  models: string
  isDefault: boolean
  isEnabled: boolean
  sortOrder: number
}

interface CatalogModel {
  id: string
  label?: string
  tier: 'free' | 'paid'
}

export default function ProvidersPage() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<Provider[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [checkingProvider, setCheckingProvider] = useState<number | null>(null)
  const [modelProvider, setModelProvider] = useState<Provider | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<Record<string, 'free' | 'paid' | undefined>>({})
  const [modelSearch, setModelSearch] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [savingModels, setSavingModels] = useState(false)
  const [form, setForm] = useState({
    name: '',
    baseUrl: '',
    apiKey: '',
    models: '[]',
    isDefault: false,
    isEnabled: true,
  })

  useEffect(() => {
    loadProviders()
  }, [])

  const loadProviders = async () => {
    setIsLoading(true)
    try {
      const data = await apiRequest<{ providers?: Provider[] }>('/admin/providers')
      setProviders(data.providers || [])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const url = editingProvider ? `/admin/providers/${editingProvider.id}` : '/admin/providers'
    const method = editingProvider ? 'PUT' : 'POST'

    await apiRequest(url, {
      method,
      body: form,
    })

    setShowModal(false)
    setEditingProvider(null)
    setForm({ name: '', baseUrl: '', apiKey: '', models: '[]', isDefault: false, isEnabled: true })
    loadProviders()
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定要删除供应商 "${name}" 吗？`)) return
    await apiRequest(`/admin/providers/${id}`, { method: 'DELETE' })
    loadProviders()
  }

  const handleSetDefault = async (id: number) => {
    await apiRequest(`/admin/providers/${id}/default`, { method: 'POST' })
    loadProviders()
	}

  const handleHealthCheck = async (id: number) => {
    setCheckingProvider(id)
    try {
      const result = await apiRequest<{ latencyMs: number }>(`/admin/providers/${id}/health`, { method: 'POST' })
      alert(`供应商连接正常，延迟 ${result.latencyMs} ms`)
    } catch (error) {
      alert(error instanceof Error ? error.message : '供应商健康检查失败')
    } finally {
      setCheckingProvider(null)
    }
  }

  const openCreate = () => {
    setEditingProvider(null)
    setForm({ name: '', baseUrl: '', apiKey: '', models: '[]', isDefault: false, isEnabled: true })
    setShowModal(true)
  }

  const openEdit = (provider: Provider) => {
    setEditingProvider(provider)
    setForm({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: '',
      models: provider.models,
      isDefault: provider.isDefault,
      isEnabled: provider.isEnabled,
    })
    setShowModal(true)
  }

  const configuredModels = (provider: Provider): CatalogModel[] => {
    try {
      const parsed = JSON.parse(provider.models) as CatalogModel[]
      return Array.isArray(parsed) ? parsed.filter(model => model.id) : []
    } catch {
      return []
    }
  }

  const openModelPicker = async (provider: Provider) => {
    setModelProvider(provider)
    setModelSearch('')
    setLoadingModels(true)
    const configured = configuredModels(provider)
    const initial: Record<string, 'free' | 'paid' | undefined> = {}
    configured.forEach(model => { initial[model.id] = model.tier === 'paid' ? 'paid' : 'free' })
    setSelectedModels(initial)
    setAvailableModels(configured.map(model => model.id))
    try {
      const data = await apiRequest<{ models?: string[] }>(`/admin/providers/${provider.id}/models`)
      setAvailableModels(Array.from(new Set([...(data.models || []), ...configured.map(model => model.id)])).sort())
    } catch (error) {
      alert(error instanceof Error ? error.message : '获取模型列表失败')
      setModelProvider(null)
    } finally {
      setLoadingModels(false)
    }
  }

  const openFormModelPicker = async () => {
    if (!form.baseUrl.trim()) {
      alert('请先填写 Base URL')
      return
    }
    if (!editingProvider && !form.apiKey.trim()) {
      alert('请先填写 API Key')
      return
    }
    const source: Provider = editingProvider || {
      id: 0,
      name: form.name || '新供应商',
      baseUrl: form.baseUrl,
      models: form.models,
      isDefault: form.isDefault,
      isEnabled: form.isEnabled,
      sortOrder: 0,
    }
    setModelProvider(source)
    setModelSearch('')
    setLoadingModels(true)
    const configured = configuredModels(source)
    const initial: Record<string, 'free' | 'paid' | undefined> = {}
    configured.forEach(model => { initial[model.id] = model.tier === 'paid' ? 'paid' : 'free' })
    setSelectedModels(initial)
    setAvailableModels(configured.map(model => model.id))
    try {
      const data = editingProvider
        ? await apiRequest<{ models?: string[] }>(`/admin/providers/${editingProvider.id}/models`)
        : await apiRequest<{ models?: string[] }>('/admin/providers/discover-models', {
            method: 'POST',
            body: { baseUrl: form.baseUrl, apiKey: form.apiKey },
          })
      setAvailableModels(Array.from(new Set([...(data.models || []), ...configured.map(model => model.id)])).sort())
    } catch (error) {
      alert(error instanceof Error ? error.message : '获取模型列表失败')
      setModelProvider(null)
    } finally {
      setLoadingModels(false)
    }
  }

  const applyModels = async () => {
    if (!modelProvider) return
    const models = availableModels
      .filter(id => selectedModels[id])
      .map(id => ({ id, label: id, tier: selectedModels[id] }))
    if (models.length === 0 && !confirm('当前没有选择任何模型，确定要清空模型目录吗？')) return
    if (modelProvider.id === 0 || editingProvider?.id === modelProvider.id) {
      setForm(current => ({ ...current, models: JSON.stringify(models) }))
      setModelProvider(null)
      return
    }
    setSavingModels(true)
    try {
      await apiRequest(`/admin/providers/${modelProvider.id}`, {
        method: 'PUT',
        body: { models: JSON.stringify(models) },
      })
      setModelProvider(null)
      await loadProviders()
    } finally {
      setSavingModels(false)
    }
  }

  const filteredModels = availableModels.filter(id =>
    id.toLowerCase().includes(modelSearch.trim().toLowerCase()),
  )

  return (
    <div>
      <PageHeader
        title={t('providers.title')}
        description="管理 AI 模型供应商，可随时切换默认或新增"
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1.5" />
            {t('providers.add')}
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <LoadingState />
        ) : providers.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="还没有供应商"
            description="添加一个 OpenAI 兼容的 API 端点开始使用"
            action={
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-1.5" />
                添加第一个供应商
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('providers.name')}</TableHead>
                <TableHead>{t('providers.baseUrl')}</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">{t('providers.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map(provider => (
                <TableRow key={provider.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{provider.name}</span>
                      {provider.isDefault && (
                        <Badge variant="default" className="gap-1">
                          <Star className="w-3 h-3 fill-current" />
                          默认
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">
                    {provider.baseUrl}
                  </TableCell>
                  <TableCell>
                    {provider.isEnabled ? (
                      <Badge variant="success">已启用</Badge>
                    ) : (
                      <Badge variant="secondary">已禁用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleHealthCheck(provider.id)}
                        disabled={checkingProvider === provider.id}
                        title="检查连接"
                      >
                        <Activity className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void openModelPicker(provider)}
                        title="获取并选择模型"
                      >
                        <ListPlus className="w-4 h-4" />
                      </Button>
                      {!provider.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetDefault(provider.id)}
                          title="设为默认"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(provider)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(provider.id, provider.name)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Modal */}
      <Dialog open={showModal} onOpenChange={open => !open && setShowModal(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProvider ? '编辑供应商' : '添加供应商'}
            </DialogTitle>
            <DialogDescription>
              填写 OpenAI 兼容 API 的连接信息
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pname">名称</Label>
              <Input
                id="pname"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="例如：OpenAI / DeepSeek"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purl">Base URL</Label>
              <Input
                id="purl"
                value={form.baseUrl}
                onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkey">API Key</Label>
              <Input
                id="pkey"
                value={form.apiKey}
                onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder={editingProvider ? '留空保留原值' : 'sk-...'}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="pmodels">模型列表 (JSON)</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => void openFormModelPicker()}>
                  <ListPlus className="mr-1.5 h-4 w-4" />
                  获取并选择模型
                </Button>
              </div>
              <Textarea
                id="pmodels"
                value={form.models}
                onChange={e => setForm({ ...form, models: e.target.value })}
                rows={4}
                className="font-mono text-xs"
                placeholder='[{"id":"gpt-4o","tier":"paid"}]'
              />
            </div>
            <div className="flex gap-6 pt-1">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={e => setForm({ ...form, isDefault: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                设为默认
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isEnabled}
                  onChange={e => setForm({ ...form, isEnabled: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                启用
              </label>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modelProvider !== null} onOpenChange={open => !open && setModelProvider(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>获取并选择模型</DialogTitle>
            <DialogDescription>
              从 {modelProvider?.name} 的 /models 接口获取目录。只有勾选的模型会对用户开放。
            </DialogDescription>
          </DialogHeader>
          {loadingModels ? <LoadingState message="正在获取供应商模型…" /> : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  value={modelSearch}
                  onChange={event => setModelSearch(event.target.value)}
                  placeholder="搜索模型 ID"
                  className="pl-9"
                />
              </div>
              <div className="max-h-96 overflow-y-auto rounded-md border border-slate-200">
                {filteredModels.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">没有匹配的模型</div>
                ) : filteredModels.map(id => {
                  const selected = selectedModels[id]
                  return (
                    <div key={id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0">
                      <input
                        type="checkbox"
                        checked={Boolean(selected)}
                        onChange={event => setSelectedModels(current => ({
                          ...current,
                          [id]: event.target.checked ? (current[id] || 'free') : undefined,
                        }))}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={id}>{id}</span>
                      <select
                        value={selected || 'free'}
                        disabled={!selected}
                        onChange={event => setSelectedModels(current => ({
                          ...current,
                          [id]: event.target.value as 'free' | 'paid',
                        }))}
                        className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs disabled:opacity-40"
                      >
                        <option value="free">免费模型</option>
                        <option value="paid">付费模型</option>
                      </select>
                    </div>
                  )
                })}
              </div>
              <div className="text-xs text-slate-500">
                已选择 {Object.values(selectedModels).filter(Boolean).length} / {availableModels.length} 个模型。保存后仍需为启用成本预算的模型配置价格版本和预留额。
              </div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setModelProvider(null)}>取消</Button>
            <Button onClick={() => void applyModels()} disabled={loadingModels || savingModels}>
              {savingModels ? '保存中…' : '保存模型目录'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
