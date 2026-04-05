# Design System Specification: The Academic Luminary

## 1. Overview & Creative North Star
**The Creative North Star: "The Digital Observatory"**
This design system is not a mere utility; it is a lens. It is designed to feel like a high-end scientific instrument—precise, deep, and illuminating. To move beyond the "generic SaaS" aesthetic, we embrace **The Digital Observatory** as our guiding metaphor. This means prioritizing deep, cosmic backgrounds with focused, high-contrast "light sources" for data and interactions.

We break the "template" look through **Intentional Asymmetry**. Do not feel forced to center-align every hero. Use wide-margin editorial layouts where the `display-lg` typography carries the visual weight, allowing white space (or "dark space") to provide the breathing room necessary for scholarly focus.

---

## 2. Color & Surface Architecture
The palette is rooted in the depth of the night sky, using `surface` tokens to create a sense of infinite space.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to define sections. Layout boundaries must be defined solely through background shifts.
*   *Correct:* A `surface-container-low` main content area sitting on a `surface` background.
*   *Incorrect:* A `1px solid #424752` line separating the sidebar from the main view.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the following tiers to define importance:
*   **Base:** `surface` (#031425) – The foundational canvas.
*   **Primary Container:** `surface-container` (#0f2132) – The main workspace.
*   **High-Priority Elements:** `surface-container-high` (#1a2b3d) – Context menus or active cards.
*   **Floating Elements:** `surface-bright` (#2a3a4d) – Modals or tooltips.

### The "Glass & Gradient" Rule
To inject "visual soul," use the following:
*   **Glassmorphism:** For top navigation and floating side panels, use `surface-container` at 70% opacity with a `20px` backdrop blur.
*   **Signature Gradients:** Primary actions should never be flat. Use a linear gradient: `primary-container` (#115cb9) to `primary` (#acc7ff) at a 135-degree angle to simulate a glowing light source.

---

## 3. Typography
We utilize a dual-font approach to balance academic authority with technical precision.

*   **Display & Headlines (Manrope):** Chosen for its geometric clarity and modern "tech" feel. Use `display-lg` with tight letter-spacing (-0.02em) to create an editorial, high-end look.
*   **Body & Labels (Inter):** The workhorse. Inter provides maximum legibility for complex scientific data. 

**Hierarchical Clarity:**
*   Always maintain a minimum 200% size scale between `headline-md` and `body-md` to ensure the "Editorial" feel is preserved.
*   Use `label-md` in all-caps with 0.05em letter-spacing for category headers to provide a "scholarly journal" aesthetic.

---

## 4. Elevation & Depth
In this system, depth is a function of light, not physics.

### The Layering Principle
Depth is achieved by "stacking" tones. Place a `surface-container-lowest` card on a `surface-container-low` section. This creates a "recessed" or "inset" feel that is sophisticated and easy on the eyes during long research sessions.

### Ambient Shadows
Shadows must be "Ambient Glows."
*   **Values:** `Y: 20px, Blur: 40px, Spread: -10px`.
*   **Color:** Use `on-surface` (#d3e4fc) at 4% opacity. This mimics how light catches the edges of a frosted lens.

### The "Ghost Border" Fallback
If a container lacks contrast, use a **Ghost Border**:
*   **Stroke:** 1px.
*   **Color:** `outline-variant` (#424752) at 20% opacity.
*   **Rule:** Never use 100% opaque borders for decorative containment.

---

## 5. Components

### Buttons
*   **Primary:** Gradient fill (`primary-container` to `primary`), `ROUND_TWELVE`, with a subtle outer glow on hover.
*   **Secondary:** Ghost Border style. No fill, `outline-variant` border at 30%, text in `primary`.
*   **Tertiary:** Text-only, using `label-md` styling.

### Input Fields
*   **Style:** `surface-container-lowest` background. No border. A 2px `primary` bottom-bar appears only on focus.
*   **Helper Text:** Use `body-sm` in `on-surface-variant` to maintain a quiet, scholarly tone.

### Cards
*   **Style:** `surface-container-low` background, `ROUND_TWELVE`.
*   **Constraint:** **Forbid dividers.** Use vertical white space (32px or 48px) to separate the card header from the body content.

### Glass Tooltips
*   **Style:** `surface-bright` at 80% opacity, `12px` backdrop blur, `ROUND_SM` corners. This makes the data feel like it’s floating above the interface.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use asymmetrical layouts (e.g., a 4-column sidebar and 8-column content area with wide gutters).
*   **Do** use "Tonal Transitions"—fading a background from `surface` to `surface-container-low` to guide the eye down a page.
*   **Do** prioritize `primary_fixed_dim` for icons to ensure they don't visually "vibrate" against the dark background.

### Don’t:
*   **Don’t** use pure black (#000000). Always use the deep midnight `surface` (#031425) to maintain the "scholarly" depth.
*   **Don’t** use traditional "Drop Shadows" (dark/heavy offsets). They feel dated and "standard."
*   **Don’t** use more than one vibrant accent color per view. The `electric blue` is a scalpel; use it precisely.
*   **Don’t** crowd the interface. If a screen feels "busy," increase the padding using the `xl` (1.5rem) spacing token.