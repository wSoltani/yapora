import * as React from "react"

import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"
import { getImage } from "@/store/storage"

/**
 * Resolves the stored avatar Blob into an object URL for the SVG <image>.
 *
 * Object URLs are revoked when they are replaced, otherwise every crop and
 * every reload would leak another copy of the image for the life of the tab.
 */
export function useAvatarImage() {
  const imageKey = useProfileStore((s) => s.profile.avatar.imageKey)
  const loaded = useProfileStore((s) => s.loaded)
  const setAvatarUrl = useAppStore((s) => s.setAvatarUrl)

  React.useEffect(() => {
    if (!loaded) return

    let url: string | null = null
    let cancelled = false

    if (!imageKey) {
      setAvatarUrl(null)
      return
    }

    void getImage(imageKey).then((blob) => {
      if (cancelled || !blob) {
        if (!blob) setAvatarUrl(null)
        return
      }
      url = URL.createObjectURL(blob)
      setAvatarUrl(url)
    })

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [imageKey, loaded, setAvatarUrl])
}
