# 模型代理配置：绕过 tun 模式

只让模型请求走 HTTP 代理，工具脚本的网络请求不受影响，从而避免开启 tun 模式。

当前相关代码位于：

- `packages/server/app/services/chat.py` — 模型调用，使用 httpx 发起请求
- `packages/server/app/config.py` — 配置读取，`ProviderConfig` 新增 `proxy` 字段
- `packages/server/requirements.txt` — 新增 httpx 依赖

---

## 背景与动机

服务器需要通过代理才能访问外部模型 API（如 `api.x.ai`）。原有方案是开启系统级 tun 模式，让所有流量走代理，但这会导致工具脚本（天气查询、邮件发送等）的网络请求也被代理，引发其他接口异常。

目标是：**只有模型调用走代理，其余网络请求保持直连。**

## 设计思路

在 provider 配置层面增加 `proxy` 字段，由调用模型的代码显式传入代理地址，而不是依赖系统全局代理。这样代理的作用域被精确限制在 `_call_model` 函数内，不会影响任何其他网络请求。

## 方案对比

### 方案 A：urllib + ProxyHandler

Python 标准库 `urllib` 支持通过 `ProxyHandler` 设置代理，但对 HTTPS 目标的代理支持残缺——无法正确建立 CONNECT 隧道，导致即使配置了代理地址，请求仍然超时。

### 方案 B：httpx（最终选择）

`httpx` 能正确处理 HTTPS over HTTP proxy 的 CONNECT 隧道，只需在构造 `Client` 时传入 `proxy=` 参数即可。

**最终选择**：方案 B。urllib 的代理实现在 HTTPS 场景下不可靠，httpx 行为符合预期且 API 更简洁。

## 具体改动

### config.py — ProviderConfig 新增 proxy 字段

原来 `ProviderConfig` 只有 `api_key` 和 `base_url`，`config.yaml` 里写的 `proxy` 字段被直接忽略，导致 `settings.llm.proxy` 永远是 `None`。

```python
class ProviderConfig(BaseModel):
    api_key: str = ""
    base_url: str = ""
    proxy: Optional[str] = None  # 新增
```

`load_settings` 中同步传递：

```python
if p.proxy:
    settings.llm.proxy = p.proxy
```

### chat.py — 替换 urllib 为 httpx

```python
with httpx.Client(proxy=proxy, timeout=60) as client:
    resp = client.post(
        _chat_completions_url(),
        json=payload,
        headers={"Authorization": f"Bearer {api_key}"},
    )
resp.raise_for_status()
```

`proxy` 为 `None` 时 httpx 直连，不走任何系统代理，工具脚本的请求完全不受影响。

### requirements.txt

```
httpx>=0.28.0,<1.0.0
```

## 使用方式

在服务器的 `config.yaml` 中，`proxy` 配置在对应 provider 下：

```yaml
providers:
  grok:
    api_key: "..."
    base_url: "https://api.x.ai/v1"
    proxy: "http://127.0.0.1:7890"

llm:
  provider: "grok"
  model: "..."
```

proxy 是 per-provider 的，切换到其他 provider 时不会误用代理。
