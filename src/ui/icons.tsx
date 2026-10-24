import {
  Cog,
  Database,
  Globe,
  Inbox,
  ScrollText,
  Server,
  ShieldCheck,
  Smartphone,
  Split,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { KINDS, type NodeKind } from "../engine";

/** One consistent icon per component kind (the engine keeps its emoji for plain-text contexts). */
export const KIND_ICON: Record<NodeKind, LucideIcon> = {
  client: Smartphone,
  cdn: Globe,
  limiter: ShieldCheck,
  lb: Split,
  server: Server,
  cache: Zap,
  db: Database,
  queue: Inbox,
  worker: Cog,
  kafka: ScrollText,
  consumer: Users,
  saga: Workflow,
};

/** A small rounded tile in the component's colour - the visual identity of a kind everywhere in the app. */
export function KindIcon({ kind, size = 16, className = "" }: { kind: NodeKind; size?: number; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={`kind-icon ${className}`} style={{ ["--kind" as string]: KINDS[kind].color }}>
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M8 22h4v-6H8zm6 0h4V10h-4zm6 0h4v-9h-4z" fill="var(--on-accent)" />
    </svg>
  );
}
