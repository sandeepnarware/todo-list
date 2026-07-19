---
name: Stitch & Flow
colors:
  surface: '#fef8f4'
  surface-dim: '#ded9d5'
  surface-bright: '#fef8f4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f8f2ef'
  surface-container: '#f3ede9'
  surface-container-high: '#ede7e3'
  surface-container-highest: '#e7e1de'
  on-surface: '#1d1b19'
  on-surface-variant: '#584140'
  inverse-surface: '#32302e'
  inverse-on-surface: '#f5f0ec'
  outline: '#8c706f'
  outline-variant: '#e0bfbd'
  surface-tint: '#ae2f34'
  primary: '#ae2f34'
  on-primary: '#ffffff'
  primary-container: '#ff6b6b'
  on-primary-container: '#6d0010'
  inverse-primary: '#ffb3b0'
  secondary: '#006a65'
  on-secondary: '#ffffff'
  secondary-container: '#79f3ea'
  on-secondary-container: '#006f69'
  tertiary: '#705d00'
  on-tertiary: '#ffffff'
  tertiary-container: '#caa800'
  on-tertiary-container: '#4c3e00'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad8'
  primary-fixed-dim: '#ffb3b0'
  on-primary-fixed: '#410006'
  on-primary-fixed-variant: '#8c1520'
  secondary-fixed: '#7cf6ec'
  secondary-fixed-dim: '#5dd9d0'
  on-secondary-fixed: '#00201e'
  on-secondary-fixed-variant: '#00504c'
  tertiary-fixed: '#ffe173'
  tertiary-fixed-dim: '#e8c426'
  on-tertiary-fixed: '#221b00'
  on-tertiary-fixed-variant: '#554500'
  background: '#fef8f4'
  on-background: '#1d1b19'
  surface-variant: '#e7e1de'
typography:
  display-timer:
    fontFamily: Plus Jakarta Sans
    fontSize: 80px
    fontWeight: '800'
    lineHeight: 80px
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  unit: 8px
  container-padding: 24px
  gutter: 16px
  radius-organic: 24px
---

## Brand & Style

This design system is built on the philosophy of "Productive Delight." It moves away from the clinical, cold nature of traditional productivity tools toward a warm, "Stitch" inspired aesthetic—characterized by organic softness, tactile comfort, and a sense of handmade precision.

The target audience consists of students, creative professionals, and neurodivergent users who seek a focused environment that feels supportive rather than demanding. The UI evokes an emotional response of calm focus and gentle encouragement.

The design style is a hybrid of **Minimalism** and **Tactile Softness**. It utilizes generous whitespace to reduce cognitive load, paired with "squishy" interactive elements, soft inner glows, and organic shapes that mimic physical patches or buttons.

## Colors

The palette is rooted in warmth and high-contrast legibility. 

- **Primary (#FF6B6B):** A "Warm Coral" used for the active Pomo state and primary calls to action. It signals energy without the anxiety of a pure red.
- **Secondary (#4ECDC4):** A "Soft Teal" used for rest states, completion marks, and secondary navigation. It provides a cooling contrast to the primary coral.
- **Accent (#FFD93D):** "Golden Amber" used for highlighting streaks, rewards, and playful micro-interactions.
- **Background (#FFF9F5):** A "Warm White" that reduces eye strain compared to pure hex-white.

In **Dark Mode**, the background shifts to a deep "Charcoal Earth" (#1A1716), while the primary and secondary colors increase in saturation slightly to maintain a high contrast ratio for accessibility.

## Typography

The typography strategy balances friendly personality with functional clarity. 

**Plus Jakarta Sans** is used for headlines and the main timer display. Its soft, open apertures and geometric curves align with the "Stitch" aesthetic. For the central timer, a heavy weight with tight tracking creates a bold, iconic focal point.

**Inter** serves as the workhorse for all body copy and task lists, ensuring maximum readability even during high-intensity focus sessions.

**JetBrains Mono** is utilized sparingly for labels, metadata, and "system" information (like durations and timestamps), providing a subtle technical contrast to the otherwise soft UI.

## Layout & Spacing

This design system uses a **Fluid Grid** with a soft 8px baseline. Content is housed within "organic containers" that use slightly irregular margins to feel less rigid.

- **Mobile:** Single column with 24px side margins. Bottom-heavy navigation for easy thumb access.
- **Desktop:** A 12-column grid with a centered "Focus Column" (max-width 800px). 
- **Spacing Philosophy:** Use "Gaps over Lines." Separate different task groups using whitespace and tonal shifts rather than heavy dividers. 

The "Pomo Circle" or main timer should always be the gravitational center of the layout, with secondary tasks orbiting it via dynamic padding.

## Elevation & Depth

Depth is achieved through **Ambient Shadows** and **Tonal Layering**. 

1. **The Base:** The primary background layer (#FFF9F5).
2. **The Patch:** Cards and containers use a slightly darker or lighter tone with a very soft, multi-layered shadow (Blur: 20px, Y: 8px, Color: 4% Primary Color Tint).
3. **The Press:** Active states and buttons use a "pressed" effect—moving from a high shadow to a zero-shadow state with a subtle 2px inner stroke to simulate physical depth.

Avoid pure black shadows. Every shadow must be tinted with the Primary or Secondary color to maintain the warm, "glowy" atmosphere.

## Shapes

The shape language is **Pill-shaped and Organic**. 

- **Containers:** All primary cards use `rounded-xl` (24px) to create a soft, friendly boundary.
- **Interaction Points:** Buttons and input fields use full pill-rounding (`rounded-full`) to encourage touch and interaction.
- **Visual Interest:** Occasional "blobs" or organic circles are used in the background or as decorative elements behind the timer to break the grid's rigidity.

## Components

- **Buttons:** Large, pill-shaped, and high-contrast. The "Start Pomo" button uses the Primary Coral with a subtle pulse animation. Secondary buttons use a "Ghost Stitch" style—transparent background with a 2px dashed border.
- **Task Chips:** Small rounded-capsules. When a task is completed, the chip should animate a "shrink-and-pop" effect, changing from Neutral to Secondary Teal.
- **Cards:** Used for task grouping. Cards should have no borders, only a soft ambient shadow and a 4px "accent strip" on the left side to denote category color.
- **Input Fields:** Soft-filled boxes with a background 2% darker than the surface. On focus, the border animates to a solid 2px Primary Coral.
- **Checkboxes:** Instead of a standard square, use a circular "Stitch" mark. When checked, the circle fills with a "star-burst" or "check" icon in a playful micro-animation.
- **Progress Bars:** Thick, rounded bars. The progress fill should have a subtle gradient from Primary to Accent.