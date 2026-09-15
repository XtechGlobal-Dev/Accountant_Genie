/**
 * Icon set: Lucide, behind a fixed vocabulary.
 *
 * Pages ask for an icon by a stable name (`<Icon name="landmark" />`) rather
 * than importing glyphs directly, so the whole app changes together when a
 * glyph is swapped, and the set of icons in use stays visible in one place.
 * Lucide draws on a 24-unit grid at a 1.75 stroke, which matches the type's
 * weight; `strokeWidth` is exposed for emphasis.
 */

import Image from "next/image";
import logoMark from "@/public/images/logo-mark.png";
import logoMarkDark from "@/public/images/logo-mark-dark.png";
import logoFull from "@/public/images/logo-full.png";
import logoFullDark from "@/public/images/logo-full-dark.png";
import { cx } from "./styles";
import {
  AlertTriangle,
  Archive,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Calculator,
  Banknote,
  BarChart3,
  Bell,
  Bot,
  Briefcase,
  Building2,
  User,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  Clock,
  Coins,
  Copy,
  Command,
  CreditCard,
  Crown,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Filter,
  Gem,
  HardHat,
  Hash,
  Headset,
  HelpCircle,
  House,
  Inbox,
  Info,
  KeyRound,
  Landmark,
  Link2,
  Phone,
  Layers,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Percent,
  Play,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Scale,
  Save,
  Search,
  Send,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Table,
  Trash2,
  Undo2,
  TrendingDown,
  Upload,
  UserPlus,
  Users,
  Wallet,
  WandSparkles,
  X,
  XCircle,
  Zap,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

const ICONS = {
  search: Search,
  plus: Plus,
  x: X,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
  "chevron-up-down": ChevronsUpDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up-right": ArrowUpRight,
  "arrow-down-left": ArrowDownLeft,
  menu: Menu,
  "log-out": LogOut,
  "log-in": LogIn,
  users: Users,
  "user-plus": UserPlus,
  building: Building2,
  briefcase: Briefcase,
  table: Table,
  hash: Hash,
  save: Save,
  landmark: Landmark,
  link: Link2,
  copy: Copy,
  user: User,
  phone: Phone,
  pen: PenLine,
  "trending-down": TrendingDown,
  banknote: Banknote,
  coins: Coins,
  "credit-card": CreditCard,
  percent: Percent,
  "hard-hat": HardHat,
  "bar-chart": BarChart3,
  "book-open": BookOpen,
  calculator: Calculator,
  home: House,
  undo: Undo2,
  "file-text": FileText,
  "file-spreadsheet": FileSpreadsheet,
  download: Download,
  upload: Upload,
  printer: Printer,
  sparkles: Sparkles,
  wand: WandSparkles,
  bot: Bot,
  shield: Shield,
  "shield-check": ShieldCheck,
  "badge-check": BadgeCheck,
  "key-round": KeyRound,
  lock: Lock,
  "alert-triangle": AlertTriangle,
  info: Info,
  "check-circle": CheckCircle2,
  "x-circle": XCircle,
  "help-circle": HelpCircle,
  inbox: Inbox,
  mail: Mail,
  send: Send,
  bell: Bell,
  zap: Zap,
  receipt: Receipt,
  wallet: Wallet,
  clock: Clock,
  calendar: Calendar,
  "calendar-days": CalendarDays,
  dashboard: LayoutDashboard,
  layers: Layers,
  command: Command,
  archive: Archive,
  scale: Scale,
  "external-link": ExternalLink,
  play: Play,
  eye: Eye,
  "eye-off": EyeOff,
  sliders: SlidersHorizontal,
  settings: Settings2,
  gem: Gem,
  crown: Crown,
  headset: Headset,
  "panel-left-close": PanelLeftClose,
  "panel-left-open": PanelLeftOpen,
  "list-checks": ListChecks,
  "clipboard-list": ClipboardList,
  filter: Filter,
  "more-horizontal": Ellipsis,
  refresh: RefreshCw,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  className = "size-4",
  strokeWidth = 1.75,
  ...rest
}: {
  name: IconName;
  className?: string | undefined;
  strokeWidth?: number | undefined;
} & Omit<LucideProps, "name" | "className" | "strokeWidth" | "ref">) {
  const Glyph = ICONS[name];
  return <Glyph className={className} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />;
}

/**
 * The brand: the genie mark on its own, and the full lockup with the wordmark.
 *
 * Both come from the supplied logo (`public/images/logo.svg`, a PNG lockup):
 * `logo-mark.png` is the "g" and both sparkles cut cleanly from
 * `logo-full.png`, on transparency. The face is a cut-out, so in the dark
 * theme it would show the ground through it; `logo-mark-dark.png` (the same
 * cut from `logo-full-dark.png`, face filled) swaps in there, exactly as
 * `BrandLogo` swaps `logo-full-dark.png` for the navy wordmark. On dark chrome
 * that has no theme (the sign-in art, printed pages) use `tone="inverse"`,
 * which puts the light mark on a white tile. `app/icon.png` (the favicon) is
 * the same mark.
 */
export function BrandMark({ className = "size-8", tone = "ink" }: { className?: string; tone?: "ink" | "inverse" }) {
  if (tone === "inverse") {
    return (
      <span className={cx("inline-flex shrink-0 items-center justify-center rounded-[26%] bg-white p-1 shadow-xs", className)}>
        <Image src={logoMark} alt="Accountant Genie" className="size-full object-contain" priority />
      </span>
    );
  }
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center", className)}>
      <Image src={logoMark} alt="Accountant Genie" className="size-full object-contain dark:hidden" priority />
      <Image src={logoMarkDark} alt="Accountant Genie" className="hidden size-full object-contain dark:block" priority />
    </span>
  );
}

/**
 * The full logo. Size it by height. The wordmark is navy, so the dark theme
 * swaps in `logo-full-dark.png`, the same lockup with the wordmark in light ink.
 */
export function BrandLogo({ className = "h-8" }: { className?: string }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center", className)}>
      <Image src={logoFull} alt="Accountant Genie" className="h-full w-auto object-contain dark:hidden" priority />
      <Image src={logoFullDark} alt="Accountant Genie" className="hidden h-full w-auto object-contain dark:block" priority />
    </span>
  );
}
