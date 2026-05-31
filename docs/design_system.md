# roadSOS Design System

Welcome to the **roadSOS** design system specification. This document outlines the visual principles, color architecture, typography scales, spacing tokens, and micro-interaction behaviors tailored for emergency roadside assistance scenarios.

---

## 1. Visual Language: "Emergency Control & Telemetry"

Roadside emergencies represent high-stress situations. The visual system of **roadSOS** is engineered to establish immediate **clarity, trust, and ease of use**.
- **Dark Mode Dominance**: Reduces eye strain in low-light, nighttime roadside environments, conserves phone battery when power might be low, and creates a premium, high-tech control center feel.
- **Glassmorphism (Frosted Surfaces)**: Visual elements float elegantly above the deep base background using semi-transparent containers, blur filters, and subtle light outlines. This directs attention without feeling claustrophobic.
- **Urgent High-Visibility Calls-to-Action**: Crucial actions (such as initiating an emergency SOS request) utilize high-intensity red pulses and crisp safety color signifiers.

---

## 2. Design Tokens: Colors & Scales

All styles are built using dynamic custom CSS variables, defined globally using the HSL color model. This facilitates easy scaling, shading, and theming.

### A. Color Palette

| Token Reference | Color Representation | HSL Value | Hex Equivalent | Core Application |
| :--- | :--- | :--- | :--- | :--- |
| `--background` | Obsidian Midnight | `hsl(223, 37%, 7%)` | `#0b0f19` | Deepest layout background |
| `--surface` | Slate Overlay | `hsla(220, 25%, 10%, 0.7)` | `#121724` (70%) | Glass containers, card bodies |
| `--surface-border` | Subtle Outline | `hsla(220, 20%, 90%, 0.08)` | `#ffffff` (8%) | Container outlines, structural dividers |
| `--primary` | Emergency Red | `hsl(355, 78%, 56%)` | `#e63946` | Brand SOS button, high-priority icons |
| `--primary-hover` | Crimson Glow | `hsl(355, 85%, 48%)` | `#dc1c2c` | SOS button active/hover state |
| `--primary-pulse` | Transparent Red | `rgba(230, 57, 70, 0.4)` | `#e63946` (40%) | Radial waves, safety rings |
| `--secondary` | Charcoal Slate | `hsl(215, 25%, 27%)` | `#343f56` | Form inputs, minor navigation items |
| `--accent` | Safety Amber | `hsl(42, 100%, 50%)` | `#ffb703` | Status labels (towing, in-progress) |
| `--success` | Safety Emerald | `hsl(142, 70%, 45%)` | `#22c55e` | Confirmation states, active resolved support |
| `--text` | Off-White Primary | `hsl(210, 20%, 98%)` | `#fafafa` | Headlines, form labels, readable body |
| `--text-muted` | Muted Gray | `hsl(218, 12%, 65%)` | `#9ca3af` | Contextual text, descriptions, footnotes |

---

## 3. Typography Scale

We employ Google Fonts' **Outfit** (modern, clean, technical geometric sans-serif) for headlines, and **Inter** (exceptionally legible, robust sans-serif) for application UI, forms, and secondary text.

```css
--font-headings: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-body: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

--text-xs:   0.75rem; /* 12px */
--text-sm:   0.875rem; /* 14px */
--text-base: 1rem;    /* 16px */
--text-lg:   1.125rem; /* 18px */
--text-xl:   1.25rem;  /* 20px */
--text-2xl:  1.5rem;   /* 24px */
--text-3xl:  1.875rem; /* 30px */
--text-4xl:  2.25rem;  /* 36px */
```

---

## 4. Spacing & Structure

A consistent 8px structural layout grid ensures seamless alignments.

- **Spacing Increments**:
  - `var(--space-1)` = `0.25rem` (4px)
  - `var(--space-2)` = `0.5rem` (8px)
  - `var(--space-3)` = `0.75rem` (12px)
  - `var(--space-4)` = `1.0rem` (16px)
  - `var(--space-6)` = `1.5rem` (24px)
  - `var(--space-8)` = `2.0rem` (32px)
  - `var(--space-12)` = `3.0rem` (48px)
- **Container Radii**:
  - `var(--radius-sm)` = `6px`
  - `var(--radius-md)` = `12px` (standard card surfaces)
  - `var(--radius-lg)` = `24px` (large structural segments)
  - `var(--radius-pill)` = `9999px` (circular actions, pills)

---

## 5. Micro-Animations & Interactivity

To keep the application responsive and engaging:
1. **Interactive Glow**: Glass cards display a subtle back-lighting glow transition when hovered.
2. **Infinite Emergency Pulse**: The main SOS call action radiates semi-transparent glowing waves outwards continuously, drawing focus.
3. **Smooth State Transitions**: All standard interactions (button states, form-focus, anchor color adjustments) share a global transitional standard:
   `transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);`
