# PetsTown

## Confirmed purpose

PetsTown is a fun hackathon project: a visual office launched from Codex CLI for the agents the user already has working. Pets represent those existing agents and make their activity visible. Codex remains responsible for running the work.

The delivery needs a simple Office launch action from Codex CLI that opens the office webpage. The confirmed sequence is invocation → webpage → **Start the day** → pets arrive → standup → live office activity. The user has delegated the packaging and exact invocation choice: use a local web app, launcher skill and plugin as needed to make the experience work. A command like `/office` expresses the desired convenience, rather than a mandatory spelling or extension mechanism. Pets must exclusively use genuine ChatGPT/Codex pet assets; their retrieval remains an integration check.

The webpage is the chosen visual surface. This avoids depending on changes to the ChatGPT/Codex desktop interface.

See [integration notes](docs/integration-notes.md) for the evidence behind the launcher, existing-agent discovery, pet assets, and remaining click-to-help checks.

Visual references:

- [Automated Agentic AI Web Agency](https://github.com/JackInSightsV2/Automated-Agentic-AI-Web-Agency), built by the user.
- [Munder Difflin](https://munderdiffl.in).

These references inform the visual office experience. PetsTown is not an agency or a new agent orchestration system.

## Confirmed experience

### Visible agents

Both main agents and their spawned subagents can appear as pets. The office must remain readable rather than becoming too busy, and the user can turn subagent visibility off. Hiding a subagent affects its visibility, not its work.

Subagents are visible by default. Crowded subagent groups collapse into an expandable count beside their main agent, and a global visibility toggle can hide subagents. Hidden subagents with unresolved requests still produce a visible attention badge associated with their group.

The exact crowding threshold remains an implementation detail to tune against the available space.

### One office with project areas

Show agents from all active Codex projects together in one shared office. Each project has its own area within that office, rather than a separate room.

### Arrivals, standups and check-ins

Launching Office opens a ready screen with a **Start the day** button. Clicking it triggers the arrival and standup sequence. Pets arrive one by one, gather for a brief standup, then move to their work locations and check in as they go. The standup presents the agents' current tasks while their actual work continues. Arrivals, gatherings and social animation belong to the visual experience; work updates reflect actual agent activity.

**Start the day** is the agreed standup trigger, replacing the earlier command-launch trigger after reconciling the colleague discussion. It controls presentation only: PetsTown does not start, pause or assign work to agents. Automatic standups on new tasks or on a periodic schedule are not part of the agreed behavior.

Each main pet presents one brief factual update with playful personality and animation. Its subagents are summarized together. The user can skip the standup. Personality must not invent work, progress or agent communication.

### Real collaboration at the water cooler

A real handoff between existing agents causes the two corresponding pets to meet at the water cooler, show brief text bubbles grounded in that exchange, then return to their work locations. A visual meeting alone is not evidence of a handoff. Animations do not delay the real exchange, and unsupported or unobserved exchanges must not be invented.

### Pet lifecycle

When an agent finishes its work, its pet briefly celebrates and then relaxes in its project area. When the session closes, the pet leaves; when work resumes, it returns.

### Work locations

The office animation chooses locations from actual agent activity with playful variation: reading in a quiet corner, working at a desk, and relaxing on a sofa. Agents do not need to spend their work managing their pets' locations. This is the agreed meaning of L3.

### Attention that follows real requests

A pet shows an `!` while its agent has a real unresolved request for the user. The indicator stays visible until that request is resolved, including when the user ignores it. Ordinary status bubbles may fade.

The pet follows its agent's actual progress and waiting state. Clearing or fading an animation does not itself resume work. This decision replaces the original suggestion that an ignored help bubble would disappear automatically.

Clicking a pet opens a side panel showing its task, recent activity and any outstanding question. The target experience is to reply inside the office. The mechanism for delivering that reply to the correct existing request still needs live verification; displaying a request or accepting text locally is not proof that Codex received the response.

### Artwork

The user requested ChatGPT ImageGen 2.5 for the office artwork, in a sprite style. Generate the office environment separately from its characters: one open-plan space with project areas, a standup space, work locations and clear walking paths. Do not bake pets, speech bubbles or interaction controls into the background.

Use ChatGPT/Codex pets exclusively. Do not generate replacement pet characters, redraw native pets or substitute unrelated character packs. Asset retrieval and the available native sprite format must be verified before integration.

The available built-in image generation tool does not expose a model-version selector. Its use does not verify that ImageGen 2.5 produced the artwork.

The generated environment is saved as [office-v1.png](assets/office/office-v1.png), with its [prompt and provenance](assets/office/office-v1.prompt.md). It has been visually inspected as background artwork; interactive navigation, collisions and pet overlays have not been implemented or tested.

## Design status and implementation checks

The product interview has settled the core experience, including the reconciled decisions from the colleague discussion. [plan.md](plan.md) is the entry point for issue preparation, with the delivery scope, shared contract and proposed slices. Further user decisions are needed only if a verified integration limitation requires changing that experience. Layout tuning, animation timing and packaging mechanics can be chosen during implementation within the confirmed design.

- **Integration:** verify the supported launcher invocation, discover existing agents and subagents across active projects, and observe updates without changing their work.
- **Inspection and help:** verify how to observe outstanding requests and respond to the correct request from the browser, including request resolution elsewhere.
- **Pet assets:** obtain genuine ChatGPT/Codex pet assets and validate their format and permitted use. Generated lookalikes do not satisfy this requirement.
- **Office presentation:** tune project-area layout, crowding thresholds and animation timing. Keep the whole office readable and all outstanding help discoverable.
- **Launch and connection lifecycle:** handle repeated launches, refresh, late arrivals and lost connections consistently with the presenter-triggered ceremony and existing-agent ownership. Closing the office must not stop the underlying agents; a lost connection must not appear as successful completion.

## Delivery levels

- **L1:** A simple launch action from Codex CLI opens the office webpage, with arrivals, standup and pets visibly reflecting existing agent activity.
- **L2:** Clicking a pet opens its side panel; the user can inspect activity and respond to real requests from the office, with attention tracking actual resolution.
- **L3:** Pets move between work locations chosen by the office animation from real activity, with playful variation.

All three levels remain in the intended experience.

## Hackathon checkpoints

The demo uses three real Codex agents prepared outside PetsTown on one teammate's Mac. This is a controlled demonstration of the viewer, not a product limit of three agents or a new agent launcher. The presentation target is 90 seconds; the underlying task is background context, not the judging focus.

The first complete demo checkpoint includes Start the day, arrivals, text standup, activity-driven movement, live inspection, genuine pet artwork and one observed water-cooler handoff. In-office replies follow that checkpoint. Voice is stretch work after the text and reply experience; a live computer view follows voice. If an agent fails, show its real state and continue with the working pets; do not silently replace the live session with a replay.

The colleague discussion describes a three-person team and a five-hour build budget. This is planning context, not a verified remaining countdown. [Reconciliation notes](docs/colleague-reconciliation.md) record source precedence and the choices confirmed in this conversation.
