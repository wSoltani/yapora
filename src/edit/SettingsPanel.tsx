import {
  AudioLines,
  CircleUser,
  Layers,
  Settings2,
  Smile,
  Sparkles,
} from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { AudioSection } from "./sections/AudioSection"
import { AvatarSection } from "./sections/AvatarSection"
import { HaloSection } from "./sections/HaloSection"
import { MouthSection } from "./sections/MouthSection"
import { ProfileSection } from "./sections/ProfileSection"
import { StageSection } from "./sections/StageSection"

const TABS = [
  { value: "avatar", label: "Avatar", icon: CircleUser, Panel: AvatarSection },
  { value: "halo", label: "Halo", icon: Sparkles, Panel: HaloSection },
  { value: "mouth", label: "Mouth", icon: Smile, Panel: MouthSection },
  { value: "audio", label: "Audio", icon: AudioLines, Panel: AudioSection },
  { value: "stage", label: "Stage", icon: Layers, Panel: StageSection },
  {
    value: "profile",
    label: "Profile",
    icon: Settings2,
    Panel: ProfileSection,
  },
] as const

export function SettingsPanel() {
  return (
    <Tabs
      defaultValue="avatar"
      className="flex h-full min-h-0 w-full flex-col gap-3"
    >
      <TabsList className="grid w-full grid-cols-6">
        {TABS.map(({ value, label, icon: Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger
              render={<TabsTrigger value={value} aria-label={label} />}
            >
              <Icon />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </TabsList>

      {TABS.map(({ value, Panel }) => (
        <TabsContent key={value} value={value} className="min-h-0">
          <ScrollArea className="h-full">
            <div className="px-0.5 pr-3 pb-6">
              <Panel />
            </div>
          </ScrollArea>
        </TabsContent>
      ))}
    </Tabs>
  )
}
