import type { ModeAccent } from "@/lib/party/mode-copy";
import { BasketIcon, PotIcon, SparkleIcon } from "./icons";

/** Literal per-accent class strings — Tailwind's build-time scanner needs these spelled out, not templated. */
export const MODE_VISUAL: Record<ModeAccent, { icon: typeof BasketIcon; solid: string; soft: string; dot: string }> = {
  tomato: {
    icon: BasketIcon,
    solid: "bg-tomato text-ink",
    soft: "bg-tomato/10 text-tomato-ink border-tomato/25",
    dot: "bg-tomato",
  },
  butter: {
    icon: PotIcon,
    solid: "bg-butter text-butter-ink",
    soft: "bg-butter/15 text-butter-ink border-butter/30",
    dot: "bg-butter",
  },
  plum: {
    icon: SparkleIcon,
    solid: "bg-plum text-white",
    soft: "bg-plum/10 text-plum border-plum/25",
    dot: "bg-plum",
  },
};
