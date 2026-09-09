# Mermaid Workspace — Detailed Implementation Plan

## 1. Product Goal

Build a collaborative Mermaid workspace by **forking the existing Mermaid Live Editor** instead of rebuilding the editor from scratch.

The product will add:

- Authentication
- Multiple saved diagrams
- Nested folders
- Sharing and permissions
- Real-time collaborative editing
- Presence and remote cursors
- Version history
- Diff and restore

The product will **not** include AI.

---

## 2. Final Technical Stack

| Layer | Technology |
|---|---|
| Frontend base | Fork of Mermaid Live Editor |
| Frontend framework | SvelteKit 2 + Svelte 5 |
| Desktop editor | Monaco |
| Mobile editor | CodeMirror 6 |
| Diagram engine | Mermaid.js |
| Backend | NestJS |
| ORM | TypeORM |
| Database | PostgreSQL |
| Folder hierarchy | `parent_id + LTREE materialized path` |
| Authentication | PassportJS custom auth |
| Password hashing | Argon2id |
| Access token | JWT |
| Refresh token | Rotating refresh token |
| Realtime model | Yjs |
| Realtime transport | WebSocket |
| Monaco collaboration | `y-monaco` |
| CodeMirror collaboration | `y-codemirror.next` |
| Presence | Yjs Awareness |
| Diff | jsdiff |
| Backend architecture | Modular monolith |

Not required for MVP:

- React
- Microservices
- Redis
- Kafka
- AI
- Vector database
- Object storage

---

## 3. Repository Strategy

Use two repositories.

```text
diagram-web
└── fork directly from mermaid-js/mermaid-live-editor

diagram-api
└── NestJS backend
```

For the frontend fork:

```text
origin
└── your repository

upstream
└── mermaid-js/mermaid-live-editor
```

Periodically sync upstream changes:

```bash
git fetch upstream
git merge upstream/develop
```

or rebase if the team prefers a linear history.

### Main rule

Keep the fork as close to upstream as practical.

Do not rewrite or reorganize large parts of Mermaid Live unless necessary.

---

## 4. What Should Be Reused From Mermaid Live

Reuse as much as possible:

- Mermaid rendering
- Mermaid validation
- Monaco integration
- CodeMirror mobile integration
- Error markers
- Config editor
- Preview
- Zoom / pan
- SVG / PNG export
- Themes
- Keyboard behavior
- Responsive editor layout

New product-specific functionality:

- Login / register
- Workspace
- Folder tree
- Multi-diagram persistence
- Sharing
- Permissions
- Yjs realtime collaboration
- Presence
- Version history
- Diff
- Restore

The objective is to build a **workspace layer around Mermaid Live Editor**, not a new Mermaid editor.

---

## 5. Route Strategy

Keep the existing anonymous editor.

```text
/edit
```

This route should continue to behave like Mermaid Live:

- anonymous
- localStorage
- URL hash sharing
- no login required

Add product routes:

```text
/login
/register

/workspace/:workspaceId

/workspace/:workspaceId/diagram/:diagramId
```

The workspace route uses server persistence and realtime collaboration.

---

## 6. Two Document Modes

The frontend should support two document modes.

```text
                 Editor Surface
                      │
             ┌────────┴────────┐
             │                 │
         Local Mode       Workspace Mode
             │                 │
       localStorage             Yjs
        URL hash                │
                               WS
                                │
                               API
                                │
                            PostgreSQL
```

### Local Mode

Used by `/edit`.

Source of truth:

```text
localStorage + URL hash
```

### Workspace Mode

Used by:

```text
/workspace/:workspaceId/diagram/:diagramId
```

Source of truth:

```text
Yjs + backend persistence
```

Do not serialize saved workspace diagrams into the URL hash.

---

## 7. Frontend State Refactor

The existing Mermaid Live state should be split into two categories.

### Document State

Shared and persisted:

- Mermaid code
- Mermaid config

Workspace mode:

```text
Y.Doc
├── Y.Text("code")
└── Y.Text("config")
```

### UI State

Local only:

- pan
- zoom
- selected panel
- panel width
- theme
- editor preferences
- last opened item

Persist this in localStorage.

### State Matrix

| State | Realtime Shared | Versioned |
|---|---:|---:|
| Mermaid code | Yes | Yes |
| Mermaid config | Yes | Yes |
| Diagram title | No | No |
| Folder | No | No |
| Pan | No | No |
| Zoom | No | No |
| Sidebar width | No | No |
| UI theme | No | No |
| Cursor | Awareness only | No |
| Selection | Awareness only | No |

---

## 8. Frontend Architecture

Add product code under a dedicated namespace instead of reorganizing upstream code.

```text
src/
├── lib/
│   ├── components/          # upstream
│   ├── util/                # upstream
│   │
│   └── product/
│       ├── api/
│       ├── auth/
│       ├── workspace/
│       ├── folders/
│       ├── diagrams/
│       ├── collaboration/
│       ├── permissions/
│       └── versions/
│
└── routes/
    ├── edit/
    ├── view/
    ├── login/
    ├── register/
    └── workspace/
        └── [workspaceId]/
            ├── +page.svelte
            └── diagram/
                └── [diagramId]/
                    └── +page.svelte
```

---

## 9. Workspace UI

Suggested layout:

```text
┌───────────────────────────────────────────────────────────┐
│ Logo    My Workspace                    Share    Nam ▼    │
├───────────────────┬───────────────────────────────────────┤
│                   │ Insurance / Claims / Claim Lifecycle │
│ ▼ Insurance       ├───────────────────────────────────────┤
│   ▼ Claims        │                                       │
│      Claim Flow   │ Mermaid Code       │ Preview          │
│      Payment Flow │                    │                  │
│                   │                    │                  │
│   ▶ Policy        │                    │                  │
│                   │                    │                  │
│ ▶ Architecture    │                    │                  │
│                   │                    │                  │
│ + Folder          ├───────────────────────────────────────┤
│ + Diagram         │ Nam ● Hùng ●          Version History│
└───────────────────┴───────────────────────────────────────┘
```

New UI components:

- AppShell
- Sidebar
- FolderTree
- DiagramNode
- Breadcrumb
- ShareDialog
- CollaboratorAvatars
- VersionHistory
- VersionDiff
- RestoreDialog

---

## 10. Backend Architecture

Use a modular monolith.

```text
src/
├── auth/
├── users/
├── workspaces/
├── folders/
├── diagrams/
├── permissions/
├── collaboration/
├── versions/
├── database/
└── common/
```

Suggested detailed structure:

```text
folders/
├── folder.controller.ts
├── folder.service.ts
├── folder.repository.ts
├── folder-path.service.ts
├── folder.entity.ts
└── dto/

collaboration/
├── collaboration.gateway.ts
├── collaboration.service.ts
├── collaboration-ticket.service.ts
├── ydoc-manager.ts
├── yjs-persistence.service.ts
└── awareness.service.ts

permissions/
├── permission.service.ts
├── permission.repository.ts
└── permission.types.ts
```

---

## 11. Database Schema

### users

```text
users

id UUID PK
email
password_hash
display_name
created_at
updated_at
```

Constraints:

- unique email

---

### auth_sessions

```text
auth_sessions

id UUID
user_id UUID
refresh_token_hash
expires_at
revoked_at
created_at
user_agent
```

Never store plaintext refresh tokens.

---

### workspaces

```text
workspaces

id UUID
name
owner_id UUID
created_at
updated_at
```

---

### workspace_members

```text
workspace_members

workspace_id UUID
user_id UUID
role
```

MVP roles:

```text
owner
member
```

---

## 12. Folder Model

```text
folders

id UUID
workspace_id UUID
parent_id UUID NULL

name VARCHAR

path LTREE
depth SMALLINT

created_by UUID

created_at
updated_at
deleted_at
```

### Materialized Path

Use IDs, not folder names.

Example:

```text
Insurance
└── Claims
    └── Motor
```

Paths:

```text
f_a89cd
f_a89cd.f_b12cd
f_a89cd.f_b12cd.f_c71ab
```

A UUID can be normalized for an LTREE label:

```text
f_<uuid_without_hyphens>
```

Example:

```text
f_a0eebc999c0b4ef8bb6d6bb9bd380a11
```

### Why keep both `parent_id` and `path`

`parent_id`:

- direct children
- foreign key integrity
- move validation
- simple sidebar queries

`path`:

- ancestors
- descendants
- subtree operations
- permission inheritance
- breadcrumbs

This duplication is intentional.

---

## 13. Folder Indexes

Migration:

```sql
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE INDEX idx_folder_path
ON folders
USING GIST(path);

CREATE INDEX idx_folder_parent
ON folders(parent_id);

CREATE INDEX idx_folder_workspace
ON folders(workspace_id);
```

---

## 14. Diagram Model

```text
diagrams

id UUID
workspace_id UUID
folder_id UUID NULL
owner_id UUID

title VARCHAR

current_content TEXT
current_config TEXT

yjs_state BYTEA

version_seq INT
current_version_id UUID NULL

created_at
updated_at
deleted_at
```

Do not store:

```text
diagram.path
```

The folder already owns the hierarchy.

---

## 15. Why `current_config` Should Be TEXT

The config editor may temporarily contain invalid JSON while the user is typing.

Example:

```json
{
  "theme":
```

This is a valid editing state even though it is not valid JSON yet.

Therefore:

```text
current_config TEXT
```

is preferable to JSONB for the source document.

---

## 16. Yjs Persistence

Store:

```text
yjs_state BYTEA
```

as the CRDT snapshot.

Y.Doc:

```text
Y.Doc
├── Y.Text("code")
└── Y.Text("config")
```

Persistence:

```text
Y.encodeStateAsUpdate()
        ↓
diagrams.yjs_state
```

Also persist:

```text
current_content
current_config
```

for:

- REST reads
- search
- exports
- versioning
- debugging

---

## 17. Version Model

```text
diagram_versions

id UUID
diagram_id UUID

version_number INT

content TEXT
config TEXT

type
message

created_by UUID
created_at
```

Version types:

```text
manual
checkpoint
restore
```

Constraint:

```text
UNIQUE(diagram_id, version_number)
```

---

## 18. Sharing Model

### Folder sharing

```text
folder_members

folder_id UUID
user_id UUID
role

UNIQUE(folder_id, user_id)
```

### Root diagram sharing

```text
diagram_members

diagram_id UUID
user_id UUID
role

UNIQUE(diagram_id, user_id)
```

Roles:

```text
owner
editor
viewer
```

---

## 19. Permission Inheritance

Example:

```text
Insurance
Nam = editor

└── Claims
    └── Payment
        └── Payment Flow
```

Nam receives `editor` access to `Payment Flow`.

Resolution:

```text
diagram
   ↓
folder
   ↓
folder.path
   ↓
ancestors
   ↓
folder_members
```

For MVP:

- no explicit deny
- no complex ACL override system

If multiple grants are present, the highest role wins:

```text
owner > editor > viewer
```

Example:

```text
Insurance → viewer
Insurance/Claims → editor
```

Effective permission:

```text
editor
```

---

## 20. Permission Capabilities

### Viewer

Allowed:

- open diagram
- receive realtime updates
- view version history
- preview versions

Not allowed:

- edit
- rename
- move
- restore
- share
- delete

### Editor

Allowed:

- edit Mermaid content
- create manual versions
- create diagrams
- rename diagrams
- move diagrams

### Owner

Additionally allowed:

- share
- remove members
- move folders
- delete folders
- restore versions
- delete diagrams

Permissions can be adjusted later if needed.

---

## 21. Authentication

Use custom PassportJS authentication.

Strategies:

```text
LocalStrategy
JwtStrategy
```

Password hashing:

```text
Argon2id
```

Flow:

```text
POST /auth/login
        ↓
LocalStrategy
        ↓
Argon2 verify
        ↓
accessToken
refreshToken
```

Recommended lifetimes:

```text
Access token: ~15 minutes
Refresh token: 7–30 days
```

Refresh token rotation:

```text
old refresh token
        ↓
verify session
        ↓
revoke/replace
        ↓
issue new refresh token
```

---

## 22. Auth API

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout

GET /auth/me
```

Access token:

```text
Authorization: Bearer <token>
```

Refresh token:

```text
HttpOnly
Secure
SameSite
```

cookie.

Do not store the refresh token in localStorage.

---

## 23. WebSocket Authentication

Avoid putting the full JWT into the WebSocket URL.

Use a short-lived collaboration ticket.

Step 1:

```text
POST /diagrams/:id/collaboration-ticket
Authorization: Bearer <access-token>
```

Backend:

- authenticates user
- checks diagram permission
- creates short-lived single-use ticket

Response:

```json
{
  "ticket": "random-short-lived-ticket"
}
```

Properties:

```text
TTL: 30–60 seconds
single-use
diagram-scoped
user-scoped
```

Step 2:

```text
wss://domain/ws/collaboration/:diagramId?ticket=...
```

The WebSocket server consumes the ticket.

---

## 24. Workspace API

```text
GET /workspaces
GET /workspaces/:id
```

---

## 25. Folder API

```text
GET    /workspaces/:id/tree

POST   /folders
PATCH  /folders/:id
DELETE /folders/:id

POST   /folders/:id/members
PATCH  /folders/:id/members/:userId
DELETE /folders/:id/members/:userId
```

The server always calculates folder paths.

Never accept `path` directly from the client.

---

## 26. Diagram API

```text
POST   /diagrams
GET    /diagrams/:id
PATCH  /diagrams/:id
DELETE /diagrams/:id
```

After realtime collaboration is enabled:

```text
metadata → REST
content  → Yjs/WebSocket
```

Example metadata update:

```json
{
  "title": "Claim Lifecycle",
  "folderId": "folder-id"
}
```

Do not support REST writes for Mermaid code once Yjs is the source of truth.

---

## 27. Version API

```text
GET  /diagrams/:id/versions

POST /diagrams/:id/versions

GET  /diagrams/:id/versions/:versionId

POST /diagrams/:id/versions/:versionId/restore
```

Diff can initially be calculated client-side using jsdiff.

---

## 28. Folder Creation

Example:

```text
Insurance
└── Claims
```

Parent:

```text
path = f_a
```

New folder:

```text
id = f_b
```

Server generates:

```text
path = f_a.f_b
```

---

## 29. Folder Move

Example:

```text
Insurance
└── Claims
    └── Motor

Architecture
```

Move `Claims` under `Architecture`.

Transaction:

```text
1. lock source folder
2. validate destination
3. reject cycles
4. calculate new path prefix
5. update entire subtree
6. update parent_id
7. commit
```

Reject:

```text
A
└── B
    └── C
```

Operation:

```text
move A → C
```

because it creates a cycle.

---

## 30. Realtime Architecture

Each diagram is one collaboration room.

```text
Browser A
   │
   ▼
NestJS Collaboration Gateway
   │
   ▼
YDocManager
   │
   ├── Y.Doc diagram A
   ├── Y.Doc diagram B
   └── Y.Doc diagram C
```

Room ID:

```text
diagram:{diagramId}
```

Do not use folder or workspace as the Yjs document room.

---

## 31. Y.Doc Structure

```ts
const doc = new Y.Doc();

const code = doc.getText('code');
const config = doc.getText('config');
```

Do not put these in Y.Doc:

- title
- folder
- permissions
- workspace metadata

---

## 32. Monaco Collaboration

Desktop:

```text
Y.Text("code")
      ↕
y-monaco
      ↕
existing Monaco editor
```

The existing Monaco setup should be preserved.

---

## 33. CodeMirror Collaboration

Mobile:

```text
Y.Text("code")
      ↕
y-codemirror.next
      ↕
existing CodeMirror editor
```

Again, reuse the existing editor instead of replacing it.

---

## 34. Mermaid Preview Flow

Realtime content should feed the existing Mermaid validation/rendering pipeline.

```text
Y.Text
   ↓
editor model
   ↓
existing Mermaid validation
   ↓
mermaid.parse()
   ↓
validated state
   ↓
existing preview
```

Yjs only synchronizes the document.

Yjs should not own rendering logic.

---

## 35. Document Controller Abstraction

To avoid feedback loops, introduce a document abstraction.

Conceptually:

```text
DocumentController

├── LocalDocumentController
└── CollaborativeDocumentController
```

### LocalDocumentController

```text
editor
→ local state
→ localStorage
```

### CollaborativeDocumentController

```text
editor
↔ Yjs binding

Yjs change
→ validation state
→ Mermaid preview
```

Do not do:

```text
Yjs
→ Monaco
→ updateCode()
→ Yjs
→ Monaco
→ ...
```

Validation must not write back into Yjs.

---

## 36. YDocManager

Backend:

```text
YDocManager

Map<diagramId, ManagedYDoc>
```

When the first user joins:

```text
load diagram
   ↓
load yjs_state
   ↓
Y.applyUpdate()
   ↓
room active
```

If `yjs_state` is null:

```text
initialize from current_content + current_config
```

---

## 37. Autosave

When Y.Doc changes:

```text
Y.Doc
  ↓
dirty
  ↓
debounce 2–5 seconds
  ↓
persist
```

Persist:

```text
yjs_state
current_content
current_config
updated_at
```

Autosave must **not** create a version.

---

## 38. Room Eviction

Do not keep every opened diagram in memory forever.

When the last user disconnects:

```text
flush to DB
   ↓
wait idle timeout
   ↓
destroy Y.Doc
   ↓
remove from YDocManager
```

When someone opens it again:

```text
load from PostgreSQL
```

---

## 39. MVP Deployment Constraint

For MVP, run a single realtime backend instance.

```text
API instance #1
```

This avoids multi-node CRDT synchronization complexity.

Later, horizontal scaling may require:

- Redis Pub/Sub
- consistent room routing
- dedicated collaboration service

Do not solve this during MVP.

---

## 40. Presence

Use Yjs Awareness.

Presence data:

```text
userId
displayName
cursor
selection
```

Do not persist Awareness into PostgreSQL.

UI:

```text
[Nam] [Hùng] [Minh]

3 editing
```

Also show remote cursors and selections.

---

## 41. Viewer Realtime Behavior

Viewer can:

```text
receive document updates
receive awareness
send own awareness
```

Viewer cannot:

```text
send document updates
```

The WebSocket server must enforce this.

Frontend readonly mode alone is not sufficient.

---

## 42. Permission Revocation During Realtime Editing

Scenario:

```text
Nam is editing
Owner removes Nam
```

The backend should immediately disconnect Nam.

Track:

```text
diagramId
→ active connections
→ userId
```

Flow:

```text
PermissionChanged
      ↓
CollaborationGateway
      ↓
find matching sockets
      ↓
close connection
```

A simple in-process event mechanism is enough for the single-instance MVP.

---

## 43. Manual Version Creation

User clicks:

```text
Save version
```

Do not trust the browser to send authoritative content.

Backend reads:

```text
active Y.Doc
```

or if room is inactive:

```text
diagrams.current_content
diagrams.current_config
```

Then:

```text
authoritative state
       ↓
DB transaction
       ↓
increment version_seq
       ↓
insert diagram_versions
```

---

## 44. Auto Checkpoints

Do not create one version per Yjs update.

Instead:

```text
document changed
+
checkpoint interval passed
```

For example:

```text
15–30 minutes
```

Create:

```text
type = checkpoint
```

These checkpoints may be hidden by default in the UI.

---

## 45. Restore

Example history:

```text
v10
v11
v12 current
```

Restore v10.

Do not delete v11 or v12.

Flow:

```text
current state
      ↓
create "before restore" checkpoint
      ↓
load v10
      ↓
replace Y.Text("code")
replace Y.Text("config")
      ↓
Yjs broadcasts
      ↓
persist
      ↓
create v13 type=restore
```

Result:

```text
v10
v11
v12
v13 ← content copied from v10
```

History remains linear.

---

## 46. Restore While Collaborators Are Online

If Nam and Hùng are editing when the owner restores a version:

```text
Server changes Y.Doc
       ↓
Yjs broadcast
       ↓
Nam receives update
Hùng receives update
```

All collaborators see the restore immediately.

Show a confirmation dialog:

```text
Restore version 5?

All active collaborators will see this change immediately.
```

---

## 47. Diff

Use text diff for MVP.

Example:

```diff
 flowchart LR
 FE --> API
+API --> Redis
 API --> DB
```

Diff:

- Mermaid code
- config text

No Mermaid AST diff is needed initially.

---

## 48. Sharing MVP

Share only with registered users.

Flow:

```text
search by email
       ↓
choose viewer/editor
       ↓
create folder_members entry
```

Do not implement initially:

- email invitations
- anonymous edit links
- public collaboration links

The existing Mermaid `/edit` URL sharing can continue for anonymous diagrams.

---

## 49. Folder Sharing UI

Example:

```text
Claims

People with access

Nam                  Owner
Hùng                 Editor
Minh                  Viewer

[ Add people ]
```

Folder permissions apply to the whole subtree.

---

## 50. Sidebar Loading

Endpoint:

```text
GET /workspaces/:id/tree
```

Return a flat list.

Example:

```json
[
  {
    "id": "1",
    "parentId": null,
    "type": "folder",
    "name": "Insurance"
  },
  {
    "id": "2",
    "parentId": "1",
    "type": "folder",
    "name": "Claims"
  },
  {
    "id": "3",
    "folderId": "2",
    "type": "diagram",
    "name": "Claim Flow"
  }
]
```

The frontend builds the nested tree.

Flat data is easier to update and cache than nested JSON.

---

## 51. Drag and Drop

Support:

```text
Diagram → Folder
Folder → Folder
```

Frontend may use optimistic updates.

Backend remains the source of truth.

If the move fails:

```text
rollback frontend state
```

---

## 52. Soft Delete

Add:

```text
deleted_at
```

to:

- folders
- diagrams

Deleting a folder soft-deletes:

- the folder
- all descendant folders
- diagrams in the subtree

This enables a future Trash feature without redesigning the schema.

---

## 53. Deployment

Prefer same-origin deployment.

```text
https://diagram.example.com/
        ↓
SvelteKit static frontend

https://diagram.example.com/api/*
        ↓
NestJS REST

wss://diagram.example.com/ws/*
        ↓
NestJS WebSocket
```

Reverse proxy:

```text
/
→ frontend

/api
→ NestJS REST

/ws
→ NestJS WebSocket
```

Advantages:

- simpler cookies
- simpler CORS
- simpler WebSocket auth
- simpler security headers

---

## 54. Security

Treat diagrams loaded from other users as untrusted content.

Requirements:

- preserve Mermaid config sanitization
- server-side authorization everywhere
- viewer cannot write Yjs updates
- validate folder access
- validate workspace access
- rate-limit login
- Argon2id password hashing
- hash refresh tokens
- short-lived JWTs
- avoid JWTs in long-lived URLs
- protect all folder moves and subtree updates with transactions
- do not trust frontend permission checks

---

## 55. Testing Strategy

### Frontend

Reuse the existing Mermaid Live test stack.

Test:

- `/edit` still works
- `/view` still works
- URL hash share still works
- Monaco still works
- mobile CodeMirror still works
- SVG export still works
- config editor still works
- invalid Mermaid handling still works
- pan / zoom still works

### Backend Unit Tests

Test:

- folder path construction
- folder move
- cycle detection
- permission resolution
- version numbering
- restore logic
- authentication token logic

### Integration Tests

Use PostgreSQL.

Test:

- TypeORM entities
- LTREE queries
- folder move transaction
- subtree updates
- permission inheritance
- version transaction

### E2E Tests

Use two browser contexts:

```text
Nam browser
Hùng browser
```

Scenario:

```text
Nam types
→ Hùng sees it

Hùng types
→ Nam sees it
```

---

## 56. Mandatory Realtime Test Cases

Test all of these:

```text
A + B type simultaneously
disconnect / reconnect
browser refresh
server restart
viewer attempts write
permission removed while connected
restore while two users are editing
folder moved while diagram is open
temporary network loss
two tabs with the same account
```

Do not implement custom CRDT conflict resolution.

Use Yjs.

---

# Implementation Phases

## Phase 0 — Fork and Stabilize

Tasks:

- fork Mermaid Live Editor
- configure upstream remote
- build the project successfully
- run existing tests
- add product namespace
- add regression tests
- update insecure dependencies if needed

Deliverable:

```text
your fork behaves like current Mermaid Live
```

---

## Phase 1 — Editor State Abstraction

Goal:

```text
LocalDocumentController
CollaborativeDocumentController
```

Tasks:

- separate document state from UI state
- abstract document persistence
- preserve `/edit`
- preserve `/view`
- extract reusable editor surface
- keep URL hash behavior only for local mode

Deliverable:

```text
/edit behaves like upstream
but editor architecture can support another document source
```

This is the most important frontend refactor.

---

## Phase 2 — Backend Foundation

Build:

- NestJS project
- ConfigModule
- DatabaseModule
- TypeORM
- PostgreSQL
- migrations
- health endpoint
- global error handling
- structured logging

Create tables:

- users
- auth_sessions
- workspaces
- workspace_members
- folders
- folder_members
- diagrams
- diagram_members
- diagram_versions

Deliverable:

```text
API + DB foundation ready
```

---

## Phase 3 — Authentication

Implement:

- register
- login
- refresh
- logout
- `/auth/me`
- Passport LocalStrategy
- Passport JwtStrategy
- Argon2id
- refresh token rotation

Frontend:

- `/login`
- `/register`
- auth store
- protected workspace routes

Deliverable:

```text
Login
→ Workspace
```

---

## Phase 4 — Workspace and Folder Hierarchy

Implement:

- workspace
- folder create
- nested folders
- rename
- move
- delete
- LTREE
- cycle detection
- sidebar tree
- drag and drop

Deliverable:

```text
Insurance
├── Claims
├── Policy
└── Motor
```

works like a file explorer.

---

## Phase 5 — Multi-Diagram Persistence

Implement:

- create diagram
- open diagram
- rename diagram
- move diagram
- delete diagram
- load diagram into existing Mermaid editor

Temporary autosave may use REST during this phase.

Important:

This REST content-write path is transitional and should be removed after Yjs is enabled.

Deliverable:

```text
Mermaid Live
+
account
+
multiple persisted diagrams
```

This is the first usable single-user MVP.

---

## Phase 6 — Sharing and Permissions

Implement:

- folder_members
- diagram_members
- owner/editor/viewer
- LTREE permission inheritance
- ShareDialog
- PermissionService
- backend authorization guards

Deliverable:

```text
Nam shares Claims folder with Hùng
→ Hùng sees the entire Claims subtree
```

---

## Phase 7 — Yjs Realtime Collaboration

Implement:

- Y.Doc
- Y.Text("code")
- Y.Text("config")
- WebSocket gateway
- collaboration ticket auth
- YDocManager
- y-monaco
- y-codemirror.next
- Yjs persistence
- reconnect
- room eviction

Remove REST writes for Mermaid content.

Deliverable:

```text
Nam + Hùng edit the same diagram in real time
```

---

## Phase 8 — Presence

Implement:

- Yjs Awareness
- collaborator avatars
- cursor
- selection
- disconnect cleanup
- permission revocation disconnect

Deliverable:

```text
Nam can see Hùng's cursor
Hùng can see Nam's cursor
```

---

## Phase 9 — Version History

Implement:

- manual version
- version sequence
- auto checkpoint
- version list
- version preview

Deliverable:

```text
v1
v2
v3
```

---

## Phase 10 — Diff and Restore

Implement:

- code diff
- config diff
- pre-restore checkpoint
- restore into Y.Doc
- realtime restore broadcast
- restore version record

Deliverable:

```text
compare v3 ↔ v5
restore v3
→ all connected users see the restored state
```

---

## Phase 11 — Production Hardening

Test and improve:

- permissions
- WebSocket security
- disconnect / reconnect
- server restart
- DB recovery
- large diagrams
- invalid Mermaid
- folder move race conditions
- version race conditions

Add:

- metrics
- structured logs
- rate limits
- error reporting
- backups

---

## Phase 12 — UX Polish

Only after the core product is stable.

Possible additions:

- Trash
- search
- keyboard shortcuts
- recent diagrams
- duplicate diagram
- duplicate folder
- public/unlisted sharing
- invitations
- activity history

---

# Epic Breakdown

```text
EPIC-01 Upstream Fork & Regression
EPIC-02 Editor State Abstraction
EPIC-03 NestJS Foundation
EPIC-04 Authentication
EPIC-05 Workspace
EPIC-06 Folder Hierarchy
EPIC-07 Diagram Persistence
EPIC-08 Sharing & Permission
EPIC-09 Yjs Collaboration
EPIC-10 Presence
EPIC-11 Version History
EPIC-12 Diff & Restore
EPIC-13 Production Hardening
```

Dependency:

```text
EPIC-01
   ↓
EPIC-02

EPIC-03
   ↓
EPIC-04
   ↓
EPIC-05
   ↓
EPIC-06
   ↓
EPIC-07
   ↓
EPIC-08
   ↓
EPIC-09
   ↓
EPIC-10
   ↓
EPIC-11
   ↓
EPIC-12
   ↓
EPIC-13
```

Frontend state refactor and backend foundation can partially run in parallel.

---

# MVP Completion Flow

The MVP is complete when this flow works end-to-end:

```text
Nam
 ↓
register/login
 ↓
Personal Workspace
 ↓
create Insurance folder
 ↓
create Claims folder
 ↓
create Claim Lifecycle diagram
 ↓
existing Mermaid Live editor opens
 ↓
diagram is persisted
 ↓
share Claims with Hùng as editor
 ↓
Hùng logs in
 ↓
Hùng sees Claims
 ↓
Hùng opens Claim Lifecycle
 ↓
Nam + Hùng edit in realtime
 ↓
both see each other's cursors
 ↓
Nam saves Version 1
 ↓
both continue editing
 ↓
Hùng saves Version 2
 ↓
compare v1 ↔ v2
 ↓
Nam restores v1
 ↓
v3 is created as restore version
 ↓
Hùng immediately sees the restored content
```

If this flow is stable, the core product is complete.

---

# Final Architecture Decisions

| Problem | Decision |
|---|---|
| New frontend? | No |
| Frontend base | Fork Mermaid Live Editor |
| Framework | SvelteKit / Svelte |
| Anonymous editor | Keep `/edit` |
| Saved diagram route | `/workspace/.../diagram/...` |
| Backend | NestJS |
| ORM | TypeORM |
| Auth | PassportJS custom auth |
| Database | PostgreSQL |
| Folder model | `parent_id + LTREE` |
| Folder path | ID-based materialized path |
| Realtime | Yjs |
| Transport | WebSocket |
| Monaco binding | y-monaco |
| CodeMirror binding | y-codemirror.next |
| Presence | Yjs Awareness |
| Current persistence | Yjs snapshot + plain text |
| Version persistence | Plain Mermaid/config snapshot |
| Autosave creates version | No |
| Folder uses CRDT | No |
| Sharing | Folder-inherited ACL |
| Multi-instance realtime | Not in MVP |
| Redis | Not in MVP |
| AI | No |

---

# Highest-Risk / Highest-Priority Engineering Area

The most important architectural work is:

```text
EPIC-02 — Editor State Abstraction
```

If this is done correctly:

- Mermaid Live upstream changes remain easier to merge
- local `/edit` remains intact
- workspace mode can use Yjs cleanly
- Mermaid rendering code remains reusable
- collaboration logic stays separated from upstream UI logic

Avoid directly scattering API and Yjs logic across:

```text
state.svelte.ts
Editor.svelte
View.svelte
```

Instead, introduce a product-specific document abstraction around the existing editor.

That is the key decision for keeping the fork maintainable over time.
