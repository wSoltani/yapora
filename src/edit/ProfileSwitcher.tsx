import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useProfileStore } from "@/store/profile"

/**
 * Switches the active profile from anywhere in the editor. Switching also
 * switches what OBS shows, since OBS always renders the active profile.
 */
export function ProfileSwitcher() {
  const activeId = useProfileStore((s) => s.profile.id)
  const profiles = useProfileStore((s) => s.profiles)
  const switchTo = useProfileStore((s) => s.switchTo)

  if (profiles.length === 0) return null

  return (
    <Select
      value={activeId}
      onValueChange={(value) => {
        if (typeof value === "string") void switchTo(value)
      }}
      items={profiles.map((p) => ({ label: p.name, value: p.id }))}
    >
      <SelectTrigger
        className="h-8 max-w-52 min-w-32 bg-background/80 text-xs shadow-lg backdrop-blur"
        aria-label="Active profile"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
