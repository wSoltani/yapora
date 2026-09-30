import * as React from "react"
import { Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, SectionGroup, SwitchField } from "@/edit/controls"
import { invoke, inApp } from "@/lib/native"

interface ServerInfo {
  url: string
  running: boolean
  error: string | null
}

/** Outside the app (a dev browser tab) this page is itself the live URL. */
function fallbackServerInfo(): ServerInfo {
  const url = new URL(window.location.href)
  url.searchParams.set("mode", "live")
  url.hash = ""
  return { url: url.toString(), running: true, error: null }
}

export function OutputSection() {
  const [server, setServer] = React.useState<ServerInfo>(fallbackServerInfo)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!inApp) return
    void invoke<ServerInfo>("server_info").then(setServer)
  }, [])

  const setObsEnabled = async (enabled: boolean) => {
    setBusy(true)
    try {
      setServer(await invoke<ServerInfo>("set_obs_enabled", { enabled }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionGroup title="OBS">
        {inApp && (
          <SwitchField
            label="Stream to OBS"
            description="Serves your avatar on a local address for an OBS Browser Source."
            checked={server.running}
            disabled={busy}
            onChange={(enabled) => void setObsEnabled(enabled)}
          />
        )}

        {server.error && (
          <div className="rounded-md bg-destructive/10 p-2.5 text-[10px] leading-relaxed text-destructive">
            {server.error}
          </div>
        )}

        {server.running && (
          <>
            <Field label="Browser source URL">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={server.url}
                  className="h-8 font-mono text-[10px]"
                  onFocus={(event) => event.target.select()}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(server.url)
                    toast.success("URL copied")
                  }}
                  aria-label="Copy URL"
                >
                  <Copy />
                </Button>
              </div>
            </Field>

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Add a Browser Source with this URL, sized as a square (1000
              &times; 1000 works well), and leave its background transparent.
              Yapora reads the microphone itself and streams to OBS, so OBS
              needs no launch flags or mic permission &mdash; just keep this app
              open while you stream.
            </p>
          </>
        )}
      </SectionGroup>
    </div>
  )
}
