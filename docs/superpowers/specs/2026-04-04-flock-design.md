# Flock — Family Travel Itinerary Builder

**Date:** 2026-04-04
**Purpose:** Competition demo — a single-page app that shows how Flock matches family members to travel activities based on individual preferences.
**Tech:** Single self-contained HTML file. Vanilla JS + CSS animations. No build tools, no dependencies.
**Target display:** Projector / large screen (1440px+ widescreen layout).

---

## Core Concept

Flock builds a trip itinerary where every activity is matched to specific family members based on their interests, energy level, and accessibility needs. The key differentiator: each activity card explains *why* it was chosen for each person, using short factual statements. Family members who sit out an activity get a "meanwhile" alternative at the same location.

A "wildcard" feature lets one reluctant family member pick a non-negotiable activity, which is shown to boost their satisfaction score.

Budget is tracked at the trip level, not per booking.

---

## Demo Data

Pre-loaded family (app launches with this data, ready to present):

| Name | Role | Age | Interests | Energy | Accessibility |
|------|------|-----|-----------|--------|---------------|
| Sarah | Mom | 38 | Photography, food, relaxation | Medium | None |
| Ruth | Grandma | 67 | History, gardens, scenic views | Low | Low mobility |
| Jake | Teen | 14 | Adventure, street food, anything-not-boring | High | None |

**Trip:** Pacific Northwest, 3 days, $2,500 budget.
**Signature colors:** Sarah = purple (#7C3AED), Ruth = blue (#2563EB), Jake = cyan (#06B6D4). These colors are used consistently across avatars, tags, reaction labels, and accent borders throughout the entire app.

---

## Visual Style

**Direction:** Modern & Sharp (Option B from brainstorming).

- Purple-to-blue gradient accents (#7C3AED → #2563EB)
- Clean sans-serif typography (system-ui)
- White cards on light gray (#F8FAFC) background
- Rounded corners (12-14px on cards)
- Subtle box shadows, no hard borders
- Each family member has a signature color used on their avatar, tags, reaction labels, and card accents
- Large fonts and generous padding for projector readability

---

## Screen 1: Family Setup

**Layout:** Centered content, horizontal card row.

**Header bar:**
- FLOCK logo (left)
- Trip destination + duration (center-right)
- Budget display with editable amount and empty progress bar (right)

**Main area:**
- Heading: "Who's coming?" with subtitle
- Horizontal row of member cards (280px each), each showing:
  - Avatar (initial on colored rounded-square)
  - Name, role, age
  - Interest tags as emoji-prefixed colored chips
  - Energy level and accessibility as subtle metadata text
  - Edit icon
  - Color accent: top border in member's signature color
- "Add family member" card (dashed border placeholder)

**Footer:**
- "Build Our Itinerary" button (purple-to-blue gradient, centered, with shadow)

**Behavior:**
- Edit icon opens an inline edit form (expand the card or show a modal — keep it simple)
- Budget is editable (click to type)
- "Build Our Itinerary" transitions to Screen 2

---

## Screen 2: Matching Animation

**Duration:** ~4 seconds total. Pure CSS keyframe animations, no JS animation libraries.
**Background:** Dark (#0F0B2E) to make colored elements pop on projector.

**Phase 1 — Scatter (0-1s):**
- The 3 member avatars appear centered
- Interest chips (emoji-prefixed tags) float outward from each avatar
- Chips drift across the screen with slight rotation, in each member's signature color

**Phase 2 — Match (1-2.5s):**
- Chips cluster together and merge into activity cards
- Each forming card shows the activity name and small member avatars for who matched
- Cards glow briefly with a colored border as they form

**Phase 3 — Settle (2.5-4s):**
- Day headers ("Day 1 - Seattle", etc.) fade in
- Activity cards slide into position under their respective days
- Progress bar at bottom fills to 100% with the gradient

**Progress bar:**
- Bottom of screen, full width
- Text: "Matching your family to the Pacific Northwest..."
- Gradient fill (purple → blue → cyan) that advances through the phases

**On completion:** Auto-transitions to Screen 3.

---

## Screen 3: Itinerary

**Layout:** Widescreen 2-column grid for activity cards.

### Header Bar (persistent)
- FLOCK logo (left)
- Satisfaction scores (center): each member's avatar + percentage, always visible
- Budget tracker (right): spent / total

### Day Tabs
- Horizontal tabs below header: "Day 1 - Seattle", "Day 2 - Portland", "Day 3 - Columbia Gorge"
- Active tab has purple bottom border + bold text
- Clicking a tab shows that day's activities

### Activity Cards
Each card contains:
- **Time** (top-left, small gray text)
- **Activity name** (large, bold)
- **Location, duration, cost** (gray subtitle)
- **Member avatars** (top-right) — colored rounded-squares for each matched member
- **Reaction section** (gray background inset): one line per matched member, format: `[Avatar] Name: Short factual statement about why this place matches them`

Reactions are short factual statements, not conversational comments. Examples:
- "Iconic fish-throwing and neon signs to photograph"
- "Home to the original 1907 Starbucks"
- "Beecher's mac & cheese and fresh mini donuts"

### "Meanwhile" Alternatives
When a family member sits out an activity, a colored callout appears below the reaction section:
- Background tinted in the absent member's color (very light)
- Left border in their signature color
- Format: "Meanwhile, [Name]: [Alternative activity] — [Short factual reason]"

This ensures no one is "left behind" — they always have something to do.

### Wildcard Card
Visually distinct from regular activity cards:
- Dark background (gradient #1E1B4B → #312E81)
- Large faint joker emoji watermark in corner
- Header: "Wildcard Pick" label + member name + subtitle "One non-negotiable activity — no questions asked"
- Activity details in a translucent inset card (name, location, duration, cost)
- Factual reason statement in muted purple
- Satisfaction boost display: "82% → 91% (+9%)" in green

### Bottom CTA Bar
- Left: summary text ("3 days - 9 activities - everyone's happy") + total cost
- Right: "Book Everything" button (purple-to-blue gradient with shadow)

---

## Demo Itinerary Content

Real PNW locations across 3 days:

### Day 1 — Seattle
| Time | Activity | Who | Cost |
|------|----------|-----|------|
| 9:00 AM | Pike Place Market | Sarah, Ruth, Jake | $45 |
| 1:00 PM | Chihuly Garden and Glass | Sarah, Ruth (Jake → Great Wheel) | $89 |
| 4:00 PM | Seattle Underground Tour | Ruth, Jake (Sarah → Penrose Spa) | $66 |

### Day 2 — Portland
| Time | Activity | Who | Cost |
|------|----------|-----|------|
| 9:30 AM | Portland Japanese Garden | Sarah, Ruth (Jake → skateboard park) | $60 |
| 12:30 PM | Food Cart Pods on Hawthorne | Sarah, Jake (Ruth → Powell's Books cafe) | $40 |
| 3:00 PM | Portland Art Museum | Sarah, Ruth, Jake | $54 |

### Day 3 — Columbia Gorge
| Time | Activity | Who | Cost |
|------|----------|-----|------|
| 9:00 AM | Multnomah Falls viewpoint | Sarah, Ruth, Jake | $0 |
| 11:30 AM | Bridge of the Gods hike | Jake (Sarah/Ruth → Bonneville fish hatchery) | $5 |
| 2:00 PM | Hood River waterfront & breweries | Sarah, Ruth, Jake | $55 |

**Wildcard:** Jake picks MoPOP (Museum of Pop Culture), Seattle, $95. Inserted into Day 1 evening.

**Total:** $1,847 of $2,500 budget.

---

## Satisfaction Scores

Static values for the demo (not dynamically calculated):

| Member | Score | Rationale |
|--------|-------|-----------|
| Sarah | 94% | 8/9 activities match her interests, plus alternatives when she opts out |
| Ruth | 89% | All activities are accessible, alternatives for high-energy ones |
| Jake | 82% (→ 91% with wildcard) | Adventure and food well-covered, wildcard adds his personal pick |

---

## Interactions

This is a demo, not a production app. Keep interactions simple:

- **Screen 1:** Edit member cards (inline expand or modal), edit budget, click "Build Our Itinerary"
- **Screen 2:** Non-interactive. Auto-plays animation, auto-transitions to Screen 3.
- **Screen 3:** Click day tabs to switch days. Wildcard card has a dropdown or modal to let the presenter "pick" Jake's wildcard. Book Everything button shows a success state (confetti or checkmark).

No routing library — use JS to show/hide screen divs. CSS transitions for screen changes (fade or slide).

---

## File Structure

Single file: `flock.html`

Everything self-contained:
- Inline `<style>` block with all CSS (variables, animations, layout, responsive)
- Inline `<script>` block with all JS (screen navigation, tab switching, animation triggers, demo data)
- HTML structure with 3 screen divs, toggled via JS

No external dependencies. Open the file in a browser and it works.
