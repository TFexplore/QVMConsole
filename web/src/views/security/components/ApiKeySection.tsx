/**
 * API 凭证区块
 * - 显示 API ID、脱敏 Key 标识和使用状态
 * - 支持生成、轮换、撤销；明文 API Key 仅在生成响应后保留在当前页面内存中
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Banner, Button, Input, Select, Tag, Toast, Tooltip } from '@douyinfe/semi-ui'
import { IconCopy, IconDelete } from '@douyinfe/semi-icons'
import { getAPIKeyInfo, revokeAPIKey, rotateAPIKey, type UserAPIKeyInfo } from '@/api/apiKey'
import { copyTextWithFallback } from '@/utils/clipboard'
import { confirmModal } from '@/utils/confirm'
import { formatDateTime } from '@/utils/format'
import { useUserStore } from '@/stores/user'
import { ROLES } from '@/config/constants'

/** 有效期选项，0 表示永久。 */
const EXPIRY_OPTIONS = [
  { label: '30 天', value: 30 },
  { label: '180 天', value: 180 },
  { label: '365 天', value: 365 },
  { label: '永久有效', value: 0 },
]

/** 根据当前 Key 状态推断有效期默认选项。 */
function inferExpiryDays(info: UserAPIKeyInfo | null): number {
  if (!info?.enabled) return 30
  if (!info.expires_at) return 0
  const remainDays = (new Date(info.expires_at).getTime() - Date.now()) / 86400000
  if (remainDays <= 0) return 30
  return [30, 180, 365].reduce((best, cur) => (Math.abs(cur - remainDays) < Math.abs(best - remainDays) ? cur : best), 365)
}

interface CopyActionProps {
  text: string
  label: string
}

function CopyAction({ text, label }: CopyActionProps) {
  const [copying, setCopying] = useState(false)

  const handleCopy = async () => {
    setCopying(true)
    try {
      await copyTextWithFallback(text)
      Toast.success(`${label}已复制`)
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '复制失败')
    } finally {
      setCopying(false)
    }
  }

  return (
    <Tooltip content={`复制${label}`} position="top">
      <span>
        <Button
          aria-label={`复制${label}`}
          disabled={!text}
          icon={<IconCopy />}
          loading={copying}
          size="small"
          theme="borderless"
          onClick={() => void handleCopy()}
        />
      </span>
    </Tooltip>
  )
}

export default function ApiKeySection() {
  const navigate = useNavigate()
  const role = useUserStore((s) => s.role)
  const [info, setInfo] = useState<UserAPIKeyInfo | null>(null)
  const [generatedKey, setGeneratedKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [trustedIP, setTrustedIP] = useState('')
  const [expiryDays, setExpiryDays] = useState(30)

  const loadInfo = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getAPIKeyInfo()
      setInfo(res.data || null)
      setTrustedIP(res.data?.trusted_ip || '')
      setExpiryDays(inferExpiryDays(res.data || null))
    } catch {
      // 请求层已统一提示
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadInfo()
  }, [loadInfo])

  const handleRotate = async () => {
    const publicAdminPolicy = role === ROLES.admin && !!info?.public_access_enabled
    if (publicAdminPolicy && !trustedIP.trim()) {
      Toast.warning('公网模式下必须设置一个固定受信任 IP')
      return
    }
    const enabled = !!info?.enabled
    const expiryLabel = EXPIRY_OPTIONS.find((item) => item.value === expiryDays)?.label || ''
    const confirmed = await confirmModal({
      title: enabled ? '重新生成 API 凭证' : '生成 API 凭证',
      content: enabled
        ? `重新生成后，当前 API Key 会立即失效，新 Key 有效期：${expiryLabel}。请确认外部程序已准备好更新凭证。`
        : `生成后请立即复制并保存 API Key，页面刷新或离开后无法再次查看明文。有效期：${expiryLabel}。`,
      okText: enabled ? '重新生成' : '生成',
      danger: enabled,
    })
    if (!confirmed) return

    setGenerating(true)
    try {
      const res = await rotateAPIKey({
        ...(publicAdminPolicy ? { trusted_ip: trustedIP.trim() } : {}),
        expires_in_days: expiryDays,
      })
      setInfo(res.data || null)
      setTrustedIP(res.data?.trusted_ip || '')
      setGeneratedKey(res.data?.api_key || '')
      Toast.success(res.message || 'API 凭证已生成')
    } catch {
      // 请求层已统一提示（428 高风险验证由请求层自动处理）
    } finally {
      setGenerating(false)
    }
  }

  const handleRevoke = async () => {
    const confirmed = await confirmModal({
      title: '撤销 API 凭证',
      content: '撤销后，使用当前 API Key 的外部程序将立即失去接口访问权限。',
      okText: '撤销',
      danger: true,
    })
    if (!confirmed) return

    setRevoking(true)
    try {
      const res = await revokeAPIKey()
      setGeneratedKey('')
      await loadInfo()
      Toast.success(res.message || 'API 凭证已撤销')
    } catch {
      // 请求层已统一提示（428 高风险验证由请求层自动处理）
    } finally {
      setRevoking(false)
    }
  }

  const publicAdminPolicy = role === ROLES.admin && !!info?.public_access_enabled

  return (
    <div className="sec-tab-pane">
      <Banner
        type="warning"
        closeIcon={null}
        className="sec-banner"
        description="API Key 可供外部程序调用兼容接口，请仅保存在可信环境中。重新生成或撤销后，旧 Key 会立即失效。"
      />

      <div className="sec-row">
        <div className="sec-row-label">状态</div>
        <div className="sec-row-main">
          <Tag color={info?.enabled ? 'green' : 'grey'}>{info?.enabled ? '已启用' : '未生成'}</Tag>
        </div>
      </div>

      <div className="sec-row">
        <div className="sec-row-label">有效期</div>
        <div className="sec-row-main">
          <Select
            style={{ width: '100%' }}
            value={expiryDays}
            onChange={(value) => setExpiryDays(Number(value))}
            optionList={EXPIRY_OPTIONS}
            disabled={generating}
          />
          <div className="sec-row-tip">仅对重新生成后的新 Key 生效；永久有效的 Key 泄露后请立即重新生成。</div>
        </div>
      </div>

      {publicAdminPolicy && (
        <>
          <div className="sec-row">
            <div className="sec-row-label">受信任 IP</div>
            <div className="sec-row-main">
              <Input
                value={trustedIP}
                onChange={setTrustedIP}
                placeholder="仅支持一个固定 IPv4 或 IPv6 地址"
                disabled={generating}
              />
              <div className="sec-row-tip">不支持 CIDR 网段、多个地址、端口或主机名；局域网请求不受此限制。</div>
            </div>
          </div>
          <div className="sec-row">
            <div className="sec-row-label">公网可用性</div>
            <div className="sec-row-main">
              <Tag color={info?.public_usable ? 'green' : 'orange'}>{info?.public_usable ? '可用于公网' : '暂不可用于公网'}</Tag>
            </div>
          </div>
        </>
      )}

      <div className="sec-row">
        <div className="sec-row-label">API ID</div>
        <div className="sec-row-main sec-input-action">
          <Input value={info?.api_key_id || '未生成'} disabled />
          <CopyAction text={info?.api_key_id || ''} label="API ID" />
        </div>
      </div>

      <div className="sec-row">
        <div className="sec-row-label">Key 标识</div>
        <div className="sec-row-main">
          <Input value={info?.key_prefix || '未生成'} disabled />
        </div>
      </div>

      <div className="sec-row">
        <div className="sec-row-label">创建时间</div>
        <div className="sec-row-main">
          <Input value={formatDateTime(info?.created_at)} disabled />
        </div>
      </div>

      <div className="sec-row">
        <div className="sec-row-label">到期时间</div>
        <div className="sec-row-main">
          <Input
            value={info?.enabled ? (info?.expires_at ? formatDateTime(info.expires_at) : '永久有效') : '未生成'}
            disabled
          />
        </div>
      </div>

      <div className="sec-row">
        <div className="sec-row-label">最后使用</div>
        <div className="sec-row-main">
          <Input value={formatDateTime(info?.last_used_at)} disabled />
        </div>
      </div>

      {generatedKey && (
        <div className="sec-row">
          <div className="sec-row-label">API Key</div>
          <div className="sec-row-main sec-input-action">
            <Input mode="password" value={generatedKey} readonly />
            <CopyAction text={generatedKey} label="API Key" />
            <div className="sec-row-tip sec-api-key-tip">
              API Key 仅在本次生成后显示一次；刷新或离开安全中心后，无法再次查看明文。
            </div>
          </div>
        </div>
      )}

      <div className="sec-row">
        <div className="sec-row-label" />
        <div className="sec-row-main sec-actions">
          <Button type="primary" theme="solid" loading={generating || loading} onClick={() => void handleRotate()}>
            {info?.enabled ? '重新生成 Key 和 ID' : '生成 Key 和 ID'}
          </Button>
          <Button
            type="danger"
            theme="light"
            icon={<IconDelete />}
            disabled={!info?.enabled || loading}
            loading={revoking}
            onClick={() => void handleRevoke()}
          >
            撤销
          </Button>
          <Button theme="borderless" onClick={() => navigate('/api-docs')}>
            查看接口文档
          </Button>
        </div>
      </div>
    </div>
  )
}
