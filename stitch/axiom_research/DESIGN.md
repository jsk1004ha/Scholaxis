# Design System Document: The Scholarly Monolith

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Curator"**
This design system moves away from the chaotic, link-heavy density of traditional academic portals. Instead, it adopts the persona of a high-end editorial gallery. We treat academic data not as "rows in a database," but as "exhibits in a museum." 

By utilizing **intentional asymmetry** and **tonal depth**, we break the rigid, "bootstrap-style" grid. The experience should feel like a premium AI-powered workspace—where the interface recedes to let the intellectual content breathe, using sophisticated layering to guide the eye through complex datasets without the need for traditional structural clutter.

---

## 2. Colors & Surface Architecture
The palette is rooted in authority and intellectual rigor, transitioning from deep, scholarly navies to ethereal, data-driven blues.

*   **Primary (Authority):** `primary` (#041627) and `primary_container` (#1a2b3c). Used for the "Monolith" elements—sidebars and headers that ground the user.
*   **Secondary (Action):** `secondary` (#115cb9). Reserved for the primary "thread of discovery"—search buttons, citations, and active filters.
*   **Tertiary (Growth/Validation):** `tertiary_container` (#123000). Used for validated research (SCI/KCI) and growth metrics.

### The "No-Line" Rule
**Borders are prohibited for sectioning.** To separate the "Search Results" from the "Filter Sidebar," do not use a 1px line. Instead, use a background shift from `surface` (#f2fbff) to `surface_container_low` (#e4f7ff). Boundaries are felt through tonal shifts, not seen through strokes.

### Surface Hierarchy & Nesting
Treat the UI as physical layers of "Scientific Glass":
1.  **Base Layer:** `surface` (The canvas).
2.  **Section Layer:** `surface_container_low` (Subtle grouping).
3.  **Content Card:** `surface_container_lowest` (#ffffff) (The "Sheet of Paper" effect).
4.  **Interaction Layer:** `surface_container_highest` (Floating modals or tooltips).

### The "Glass & Gradient" Rule
To inject "soul" into the data, use **Signature Textures**. Hero areas should feature a subtle radial gradient from `primary` to `primary_container`. Floating action panels must use **Glassmorphism**: `surface` color at 70% opacity with a `20px` backdrop-blur to maintain context of the data beneath.

---

## 3. Typography: The Editorial Scale
We use **Inter** to bridge the gap between "Technical Utility" and "Modern Elegance."

*   **Display (The Statement):** `display-lg` (3.5rem) should be used sparingly for data visualizations or high-level search tallies. It conveys power and scale.
*   **Headline (The Narrative):** `headline-sm` (1.5rem) is our primary title for research papers. It uses tight letter-spacing (-0.02em) to feel authoritative and "academic-journal" ready.
*   **Body (The Intelligence):** `body-md` (0.875rem) is the workhorse. We prioritize line-height (1.6) to ensure that dense abstracts remain readable during long research sessions.
*   **Labels (The Metadata):** `label-sm` (0.6875rem) in all-caps with increased letter-spacing (+0.05em) is used for status badges (SCI, KCI, Open Access). This differentiates "Meta-Data" from "Content."

---

## 4. Elevation & Depth
Depth in this system is achieved through **Tonal Layering**, not structural shadows.

*   **The Layering Principle:** Place a `surface_container_lowest` card on a `surface_container_low` background. This creates a "Natural Lift" that feels high-end and intentional.
*   **Ambient Shadows:** For floating elements (like a citation preview), use an "Extra-Diffused" shadow: 
    *   *Blur:* 40px | *Spread:* -10px | *Color:* `on_surface` at 6% opacity. 
    *   This mimics natural light in a bright laboratory, avoiding the "dirty" look of standard grey shadows.
*   **The "Ghost Border" Fallback:** If a divider is required for accessibility, use the `outline_variant` token at **15% opacity**. It should be a suggestion of a line, not a hard stop.

---

## 5. Components

### Elegant Search Cards
*   **Structure:** No borders. Background: `surface_container_lowest`. 
*   **Interaction:** On hover, the card doesn't move up; instead, the background shifts to `surface_bright` and the `secondary` accent increases in saturation.
*   **Layout:** Asymmetric. The title takes the top 60%, with metadata (Author, Date, Journal) tucked into a right-aligned column to create an editorial feel.

### Status Badges (KCI, SCI, Open Access)
*   **Style:** Pill-shaped (`rounded-full`). 
*   **Color Logic:** Use `tertiary_fixed` for high-impact labels (SCI) and `primary_fixed` for standard metadata. Text must be `label-sm` for a refined, technical look.

### Buttons: The "Discovery" Trigger
*   **Primary:** A subtle gradient from `secondary` (#115cb9) to a slightly darker indigo. No sharp corners (`rounded-md`).
*   **Tertiary (Ghost):** For "Download PDF" or "Cite." Text only, using `secondary` color, with a background-fill appearing only on hover at 8% opacity.

### Data Visualizations (Sophisticated Graphs)
*   **Nodes:** Use the "Accent Scale"—Green for Papers, Gold for Patents, Purple for Awards.
*   **Connectors:** Use `outline_variant` at 30% opacity. Avoid black lines; use the "Ghost Border" logic to keep the graph "airy."

---

## 6. Do's and Don'ts

### Do:
*   **Do** use vertical white space to separate search results. If you think you need a line, add 16px of padding instead.
*   **Do** use the "Korean Academic Context" by ensuring Hangeul characters are rendered with the same line-height rigor as Latin characters.
*   **Do** nest containers to show importance. An inner "Abstract" box should be a different tone than the outer "Paper" card.

### Don't:
*   **Don't** use 100% opaque black (#000000) for text. Use `on_surface` (#001f28) to maintain a high-end, "Ink-on-Paper" softness.
*   **Don't** use standard Material Design drop shadows. They look "off-the-shelf." Stick to tonal shifts and ambient, wide-blur shadows.
*   **Don't** clutter the view. If a piece of data isn't vital for the initial "Discovery" phase, hide it in a `surface_container_high` hover-state tooltip.