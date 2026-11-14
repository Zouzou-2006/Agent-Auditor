# QuickNode Stream setup

How to recreate the Stream that feeds `/api/webhooks/streams`.

## Settings

| Setting | Value |
| --- | --- |
| Network | Solana Devnet |
| Dataset | Block |
| Start | Latest slot |
| End | Run until paused |
| Compression | None |
| Destination | Webhook: `<app URL>/api/webhooks/streams` |
| Security token | Store it in `QUICKNODE_STREAMS_SECRET` (in `.env.local` and on Vercel). Never commit it. |

## Filter

```go
func Filter(qn *qn.QNContext, body []byte) interface{} {
	const gateway = "HsyoZYyJCdDiGAvQgokFPGdvEUQy2p5byzeZvEhRRbgr"
	if !strings.Contains(string(body), gateway) {
		return nil
	}
	return json.RawMessage(body)
}
```

It forwards whole blocks, not trimmed transactions, because the matcher needs the memos, token balances and inner instructions.

**Pause the Stream when you're not testing.** It bills per block.
