---
name: Kenobi
description: Private asset review with exact human-approved changes
colors:
  action: "#A100FF"
  action-rest: "#8900DA"
  accent-text: "#C77DFF"
  background: "#0B0911"
  surface: "#15101F"
  panel: "#1C1529"
  line: "#44364F"
  ink: "#F6F0FB"
  muted: "#C4B6CF"
  field: "#0D0A13"
  field-border: "#685574"
  original: "#291923"
  replacement: "#132A26"
  selected: "#60327D"
  coverage: "#201629"
  coverage-ink: "#E0CDE9"
  error: "#421C2B"
  error-ink: "#FFDCE3"
  progress: "#253C36"
  progress-ink: "#B7F3E3"
typography:
  display:
    fontSize: "clamp(32px, 4.5vw, 58px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontSize: "22px"
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "16px"
    lineHeight: 1.55
  label:
    fontSize: "14px"
    fontWeight: 600
  evidence:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontSize: "13px"
    lineHeight: 1.55
rounded:
  control: "6px"
  disclosure: "8px"
  surface: "12px"
spacing:
  compact: "8px"
  field: "12px"
  control: "16px"
  group: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action-rest}"
    textColor: "#FFFFFF"
    rounded: "{rounded.control}"
    padding: "13px 20px"
  button-primary-hover:
    backgroundColor: "{colors.action}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  text-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px"
  review-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
  coverage-disclosure:
    backgroundColor: "{colors.coverage}"
    textColor: "{colors.coverage-ink}"
    rounded: "{rounded.disclosure}"
    padding: "20px 24px"
---

# Design System: Kenobi

## Overview

**Creative North Star: "Kenobi review workspace"**

This is a descriptive record of the inherited Rockit Kenobi interface, not a new metaphor or visual direction approved by the user. Dark purple surfaces and Accenture purple retain the source product's identity. Familiar fields, file navigation and explicit decision buttons keep the emphasis on reviewing evidence.

The system uses flat, outlined surfaces and restrained state colour. Before/after text is the central visual comparison. This record is grounded in `app/globals.css` and `app/workspace.tsx`; product requirements remain in `PRODUCT.md`.

**Key Characteristics:**
- Dark purple ground with pale text and purple interaction cues.
- Exact source and replacement text shown in paired evidence areas.
- Persistent focus rings and explicit selected/disabled states.
- Responsive grids that collapse into a single reading column.

## Colors

Purple identifies the product and its actions; distinct tinted surfaces communicate evidence and operation states.

### Primary
- **Accenture action purple:** current progress steps, checkbox accents and primary-action hover.
- **Deep action purple:** primary buttons at rest, with white labels.
- **Pale purple:** links, finding categories and keyboard focus outlines.

### Neutral
- **Purple-black ground:** the page background.
- **Deep purple surfaces:** intake and approval containers, then smaller control panels.
- **Pale ink and muted lavender:** primary content and supporting explanations.
- **Muted purple rules:** dividers and outlined surfaces.

### State colours
- **Muted rose:** original evidence and errors, with different text treatments appropriate to each.
- **Deep green:** replacement evidence and processing status.
- **Selected purple:** accepted or retained decision controls.

**The Labelled State Rule.** Colour accompanies text labels or pressed states; it does not carry the decision by itself.

## Typography

Body text uses the inherited Arial/Helvetica system fallback. No licensed Graphik asset is bundled. That fallback is an implementation constraint, not a new display identity to propagate to unrelated surfaces. The current display uses the same inherited family; the display token records observed geometry without canonizing a system display face.

- **Display:** fluid intake heading; review headings use a smaller fixed size (36px desktop, 30px mobile).
- **Title:** section headings; file titles reduce to 18px and file-rail titles to 15px.
- **Body:** ordinary prose is limited to 72 characters per line where practical.
- **Labels:** compact semibold field labels; hints use 13px and evidence labels use 12px.
- **Evidence:** monospace is reserved for literal source text and replacements.

## Layout

The main container is centred with a maximum width of 1320px and desktop padding of 32px 40px 72px. Intake pairs a form with an explanatory column using a 1.1:1 ratio and a 72px gap. The review uses a 240px source-file rail and a flexible evidence area. Paired evidence fields have an 18px gap.

At 900px, primary gaps shrink to 32px, the rail narrows to 185px and evidence fields stack. At 650px, intake and review become single-column layouts, the source list becomes a bounded vertical region, and primary buttons become full width. The mobile content inset is 20px. These are observed responsive rules for this implementation, not requirements for every future page.

## Elevation & Depth

There are no shadows. Tonal differences and thin borders distinguish the page, review surfaces and controls. Focus appears as an outline rather than an elevation effect.

**The Flat Surface Rule.** Preserve the distinction between a surface border, a selected fill and a keyboard outline.

## Shapes

Controls use gently rounded corners, disclosures slightly broader corners, and major review surfaces the broadest radius in the scale. Numbered progress markers are circular because they identify workflow steps. Dividers remain thin; there are no decorative side stripes.

## Components

### Buttons
Primary controls use deep purple at rest and Accenture purple on hover. Secondary controls use outlined panel surfaces. Decision buttons use the selected fill and `aria-pressed` together. Disabled controls reduce opacity to one half and use a non-interactive cursor. Background transitions last 180ms with ease-out; reduced-motion settings remove transitions.

### Inputs / Fields
Fields use dark insets, visible muted-purple outlines and pale text. Textareas resize vertically. File input uses a dashed outline. Carets and focus outlines use the purple accent. Every interactive element receives a 3px focus outline with a 4px offset.

### Cards / Containers
Intake and approval surfaces use the shared surface radius and one border. Coverage disclosures use their own tinted surface and a conventional expandable summary. Errors and active-operation messages use labelled, separately coloured regions.

### Navigation
The header carries the Kenobi name and a restrained product descriptor. Numbered workflow markers show the current step. Source files use full-width text buttons, wrapping long paths, with a selected surface and a supporting findings count.

### Evidence comparison
Original content uses a rose-tinted `pre` area; replacements use a green-tinted textarea. Both preserve whitespace, wrap long strings and use a minimum height of 100px. Decision labels explain whether the text will change, remain, or still needs a decision.

### Completion
Completed reviews place the result and download action above read-only findings. Private residual evidence is expandable and includes the file and line. Draft-saving and approval states remain explicit text, independent of colour.

## Do's and Don'ts

### Do:
- **Do** preserve exact before/after text and visible decision labels.
- **Do** retain focus outlines, selected states and reduced-motion behaviour.
- **Do** wrap long paths and stack evidence fields when width is constrained.
- **Do** distinguish coverage limitations from successful completion.

### Don't:
- **Don't** use colour as the only indication of a decision or risk.
- **Don't** turn the inherited system display fallback into a new brand typography rule.
- **Don't** hide the result action below the complete findings list.
