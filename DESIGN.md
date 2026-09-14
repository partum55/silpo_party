---
version: alpha
name: "Silpo Party"
description: "A Ukrainian-first collaborative grocery planner with a warm shopping-list and receipt identity."
colors:
  primary: "#FF5A3C"
  paper: "#F3F5ED"
  paper-raised: "#FBFBF6"
  ink: "#2A2420"
  ink-soft: "#55493F"
  basil: "#3B8659"
  butter: "#F4B740"
  plum: "#7C4B8C"
  stone: "#C9C2B4"
  danger: "#CC3D2E"
typography:
  sans:
    fontFamily: "Manrope, system-ui, sans-serif"
  numeral:
    fontFamily: "Space Mono, ui-monospace, monospace"
rounded:
  DEFAULT: "0.7rem"
  sm: "0.5rem"
  md: "0.7rem"
  lg: "1.1rem"
spacing:
  page-inline: "1rem"
  page-max: "34rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  inline-alert-success:
    backgroundColor: "{colors.basil}"
  inline-alert-warning:
    backgroundColor: "{colors.butter}"
  inline-alert-danger:
    backgroundColor: "{colors.danger}"
  torn-panel:
    backgroundColor: "{colors.paper-raised}"
  tab-bar-agent:
    backgroundColor: "{colors.plum}"
    textColor: "{colors.paper-raised}"
  cart-item:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
  cart-item-meta:
    textColor: "{colors.ink-soft}"
  divider:
    backgroundColor: "{colors.stone}"
---

# Silpo Party — Design Context

## Product and audience

Silpo Party is a Ukrainian-first collaborative grocery planner for small parties. People describe what they want in chat, review a shared basket, split costs, and let the host transfer the confirmed list to Silpo. The primary surface is a compact mobile web app, with desktop layouts intentionally retaining the focused single-column form.

## Experience principles

- Feel like a useful shared shopping list, not an admin dashboard.
- Keep the chat and basket equally legible; state changes should be visible without a reload.
- Use Ukrainian for all user-facing copy, including agent replies and errors.
- Prefer direct, reversible cart actions. Quantity edits are pessimistic and clearly pending; failed edits preserve the last confirmed value.
- Finalization is deliberate and all-or-nothing: never imply success when only part of the basket reached Silpo.

## Visual direction

The interface uses a warm grocery-receipt metaphor: pale paper surfaces, dark food-label ink, tomato red for primary action, basil green for success, butter yellow for attention, and plum for agent/system identity. Rounded controls are friendly but compact. A torn-paper edge is the signature motif and appears only on the basket summary receipt.

Typography uses Manrope for Ukrainian body copy and Space Mono for prices and other numeric values. Product names take visual priority; secondary purchasing information and assignees remain quiet.

## Canonical tokens and primitives

`src/app/globals.css` owns color, radius, typography, focus, motion, and scrollbar tokens. This document mirrors that implementation rather than replacing it.

- Surfaces: `paper`, `paper-raised`
- Text: `ink`, `ink-soft`
- Actions: frontmatter `primary` maps to runtime `tomato`; `basil` and `danger` retain their runtime names
- Borders: `stone`, `stone-soft`, `stone-600`
- Radius: `radius-lg`, `radius-md`, `radius-sm`
- Shared controls: `Button`, `SubmitButton`, `InlineAlert`, `TornPanel`, `TabBar`
- Shared icons live in `src/components/ui/icons.tsx`

## Interaction conventions

- Interactive targets are at least 40 px where space permits and always expose visible keyboard focus.
- Icon-only controls have localized accessible names and a visible tooltip through `title`.
- Numeric cart quantity is a positive integer package count. Both direct entry and minus/plus controls are available; zero and negative values are rejected in both client and server layers.
- Cart products use live Silpo catalog imagery with a quiet basket-icon fallback. Payer avatars remain visible on every line; a participant may join a line's cost split and may withdraw only their own explicit subscription.
- Removing a cart line is immediate and pessimistic. This is a low-impact, reversible planning action and does not use a confirmation dialog.
- Inline errors stay next to the affected cart line. Controls are disabled while its mutation is pending to prevent duplicate requests.
- Layouts must tolerate Ukrainian expansion, large quantities, and long product names without horizontal overflow.

## Accessibility and resilience

Controls use semantic buttons and labeled inputs. Color is never the only indicator of error or pending state. Realtime updates may refresh the basket, but an in-flight local mutation owns its row until the server responds. Reduced-motion preferences disable decorative transitions.

## Responsive behavior

The main party surface remains a single column up to `34rem`. Cart lines stack their product details and quantity controls on narrow screens, then align horizontally when space allows. The tab bar and chat composer remain reachable within safe-area insets.
