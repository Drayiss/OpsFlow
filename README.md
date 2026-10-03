# OpsFlow

OpsFlow is a multi-tenant incident management project built with React, TypeScript, C#, and ASP.NET Core. The goal is a small application where organizations track incidents affecting their services, with tenant isolation and background notification delivery.

## Current status

The first incident workflow is implemented: select a seeded organization, choose a service, create an incident, and view the organization's latest incidents. PostgreSQL stores organizations, services, incidents, and incident events; creation records the first timeline event in the same transaction. The background worker is still a starter project.

Authentication, status changes, timeline display, audit logs, real-time updates, notifications, Redis, and cloud deployment are planned. Organization-scoped queries are implemented, but there are no membership checks yet: anyone using this local demo can select either organization. No deployment or performance results are available.

## Run locally

Prerequisites: .NET 10 SDK, Node.js 22.12+ with npm, and Docker Desktop running.

From the repository root, start PostgreSQL:

```sh
docker compose up -d --wait postgres
```

Start the API in one terminal:

```sh
dotnet run --project backend/OpsFlow.Api --launch-profile http
```

In another terminal, start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite. It proxies `/api` requests to the API at `http://localhost:5092`. In Development, API startup applies the checked-in EF Core migration and seeds Northstar and Harbor, each with one service. Create an incident, refresh to check persistence, then switch organizations to see a separate list. Lists show the latest 100 incidents.

PostgreSQL uses port 5433 and a named volume so data survives container restarts. The credentials in `compose.yaml` and `appsettings.Development.json` are for local development only. To use another database, override `ConnectionStrings__OpsFlow`. Automatic startup migrations run only in Development.

To stop PostgreSQL while keeping its data:

```sh
docker compose down
```

Build and check the application:

```sh
dotnet build OpsFlow.slnx
cd frontend
npm run build
npm run lint
```

## Minimum product scope

The main workflow is: sign in, select an organization, create an incident for a service, update its status, and see the timeline and notifications.

- Two seeded organizations with seeded memberships and two roles: Admin (read/write) and Viewer (read-only).
- Incidents with a title, description, service, and status: Open, Investigating, or Resolved.
- Incident timelines containing timestamped notes and status changes.
- Services with one designated owner each.
- Audit records identifying the organization, actor, action, target, and timestamp.
- Real-time incident updates within the authorized organization.
- One email format and one webhook payload triggered by incident status changes.

The initial UI will contain login, an incident list, incident details, services, and an audit log, with an organization selector. Invitations, custom roles, on-call schedules, escalations, attachments, and advanced analytics are outside the initial scope.

## Planned architecture

| Component | Responsibility |
| --- | --- |
| React + TypeScript | Incident forms, lists, and organization selection |
| ASP.NET Core API | Incident operations, authorization, tenant scoping, and SignalR updates |
| PostgreSQL | Shared database with organization-scoped application data |
| Redis | Cache one organization-scoped read endpoint with invalidation on changes |
| Azure Service Bus | Queue notification deliveries with retries and dead-letter handling |
| Background worker | Send email and webhooks, tracking delivery identities to handle duplicates |
| Docker + Azure | Containerized API/frontend and worker deployment |
| GitHub Actions + Application Insights | Automated builds/deployments and request, error, and worker monitoring |

Authentication will use an external OAuth/OIDC identity provider. The API will validate JWT access tokens and enforce organization membership and roles. Protected reads, writes, real-time subscriptions, and cache entries must respect organization boundaries.

## Repository layout

```text
frontend/                 React + TypeScript application
backend/OpsFlow.Api/      ASP.NET Core API
backend/OpsFlow.Worker/   Background notification worker
OpsFlow.slnx             .NET solution
```

## Implementation milestones

1. **Incident workflow:** persist services and incidents in PostgreSQL; create, list, view, and update incidents from React. Record timeline events and audit entries for supported changes.
2. **Access control:** add external login, organization memberships, Admin/Viewer permissions, and verification that users cannot access another organization's data.
3. **Live updates:** publish authorized incident updates through SignalR.
4. **Notifications:** queue email/webhook jobs; demonstrate successful delivery, duplicate handling, retries, and dead-lettered failures.
5. **Deployment:** containerize the application, deploy to Azure through GitHub Actions, and verify monitoring.
6. **Performance:** optimize PostgreSQL queries and add Redis caching for one read endpoint. Record before/after latency using the same dataset, environment, and concurrent-user load.

The next part of the first milestone is status changes, timeline display, and audit records. Performance claims will use measured results rather than estimated percentages.
