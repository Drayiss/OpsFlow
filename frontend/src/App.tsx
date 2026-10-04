import { Suspense, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  QueryErrorResetBoundary,
  useIsMutating,
  useMutation,
  useSuspenseQueries,
  useSuspenseQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import "./App.css";

type Organization = { id: string; name: string };
type Service = { id: string; name: string; ownerName: string };
type Incident = {
  id: string;
  title: string;
  description: string;
  serviceName: string;
  status: string;
  createdAt: string;
};
type IncidentEvent = {
  id: string;
  eventType: string;
  note: string;
  previousStatus: string | null;
  newStatus: string | null;
  createdAt: string;
};
type IncidentDetailsData = Incident & {
  events: IncidentEvent[];
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const messages = problem?.errors
      ? Object.values(problem.errors).flat().join(" ")
      : (problem?.detail ??
        `Request failed (${response.status}). Check that the API and database are running.`);
    throw new Error(messages);
  }
  return response.json() as Promise<T>;
}

function QueryBoundary({
  children,
  loading,
}: {
  children: ReactNode;
  loading: string;
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={({ error, resetErrorBoundary }) => (
            <section className="panel">
              <p className="error" role="alert">
                {error instanceof Error
                  ? error.message
                  : "Something went wrong."}
              </p>
              <button type="button" onClick={resetErrorBoundary}>
                Try again
              </button>
            </section>
          )}
        >
          <Suspense fallback={<p role="status">{loading}</p>}>
            {children}
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

function IncidentDetails({
  organizationId,
  incidentId,
  onClose,
}: {
  organizationId: string;
  incidentId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const path = `/api/organizations/${organizationId}/incidents/${incidentId}`;
  const detailKey = ["incident", organizationId, incidentId];

  const detailsQuery = useSuspenseQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) => api<IncidentDetailsData>(path, { signal }),
  });

  const incident = detailsQuery.data;

  const statusMutation = useMutation({
    mutationKey: ["updateIncident", organizationId, incidentId],

    mutationFn: (status: string) =>
      api<{ status: string }>(`${path}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          expectedStatus: incident.status,
        }),
      }),

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: detailKey,
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: ["incidents", organizationId],
          exact: true,
        }),
      ]);
    },

    // Reload details after a failure so conflicts show the latest status.
    onError: async () => {
      await queryClient.invalidateQueries({
        queryKey: detailKey,
        exact: true,
      });
    },
  });

  return (
    <section className="panel">
      <div className="incident-heading">
        <h2>{incident.title}</h2>
        <button
          type="button"
          disabled={statusMutation.isPending}
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <p className="muted">
        {incident.serviceName} · {new Date(incident.createdAt).toLocaleString()}
      </p>

      {incident.description && (
        <p className="description">{incident.description}</p>
      )}

      {detailsQuery.error && (
        <p className="error" role="alert">
          {detailsQuery.error.message}
        </p>
      )}

      <p>
        Current status: <strong>{incident.status}</strong>
      </p>

      <div className="status-actions">
        {["Open", "Investigating", "Resolved"].map((status) => (
          <button
            key={status}
            type="button"
            disabled={statusMutation.isPending || status === incident.status}
            onClick={() => statusMutation.mutate(status)}
          >
            {status}
          </button>
        ))}
      </div>

      {statusMutation.isPending && <p role="status">Updating status...</p>}

      {statusMutation.error && (
        <p className="error" role="alert">
          {statusMutation.error.message}
        </p>
      )}

      {statusMutation.isSuccess && (
        <p className="notice" role="status">
          Status updated.
        </p>
      )}

      <h3>Timeline</h3>

      {incident.events.length === 0 ? (
        <p>No events yet.</p>
      ) : (
        <ol className="incidents">
          {incident.events.map((event) => (
            <li key={event.id}>
              <p>{event.note}</p>
              <time className="muted" dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Workspace({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const base = `/api/organizations/${organizationId}`;
  // Start both requests together instead of suspending on each in sequence.
  const [servicesQuery, incidentsQuery] = useSuspenseQueries({
    queries: [
      {
        queryKey: ["services", organizationId],
        queryFn: ({ signal }) => api<Service[]>(`${base}/services`, { signal }),
      },
      {
        queryKey: ["incidents", organizationId],
        queryFn: ({ signal }) =>
          api<Incident[]>(`${base}/incidents`, { signal }),
      },
    ],
  });
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const updatingIncident =
    useIsMutating({
      mutationKey: ["updateIncident", organizationId],
    }) > 0;
  const services = servicesQuery.data;
  const incidents = incidentsQuery.data;
  const serviceId = services.some((service) => service.id === selectedServiceId)
    ? selectedServiceId
    : (services[0]?.id ?? "");

  const createMutation = useMutation({
    mutationKey: ["createIncident", organizationId],
    mutationFn: (input: {
      serviceId: string;
      title: string;
      description: string;
    }) =>
      api<{ id: string }>(`${base}/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      setTitle("");
      setDescription("");
      // Refresh only this organization's list from the source of truth.
      await queryClient.invalidateQueries({
        queryKey: ["incidents", organizationId],
        exact: true,
      });
    },
  });

  function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createMutation.isPending) return;
    createMutation.mutate({ serviceId, title, description });
  }

  return (
    <>
      {servicesQuery.error && (
        <p className="error" role="alert">
          {servicesQuery.error.message}
        </p>
      )}
      {incidentsQuery.error && (
        <p className="error" role="alert">
          {incidentsQuery.error.message}
        </p>
      )}
      {createMutation.error && (
        <p className="error" role="alert">
          {createMutation.error.message}
        </p>
      )}
      {createMutation.isSuccess && (
        <p className="notice" role="status">
          Incident created.
        </p>
      )}
      <section className="panel">
        <h2>Create incident</h2>
        <form onSubmit={createIncident}>
          <fieldset
            disabled={createMutation.isPending || services.length === 0}
          >
            <label htmlFor="service">Affected service</label>
            <select
              id="service"
              value={serviceId}
              onChange={(event) => setSelectedServiceId(event.target.value)}
              required
            >
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} (owner: {service.ownerName})
                </option>
              ))}
            </select>
            <label htmlFor="title">Title</label>
            <input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={200}
              placeholder="Checkout API is returning errors"
            />
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={4000}
              rows={3}
            />
            <button type="submit" disabled={!title.trim()}>
              {createMutation.isPending ? "Creating..." : "Create incident"}
            </button>
          </fieldset>
        </form>
      </section>
      <section className="panel">
        <h2>Incidents</h2>
        <p className="muted">Latest 100 incidents in this organization.</p>
        {incidents.length === 0 ? (
          <p>No incidents yet.</p>
        ) : (
          <ul className="incidents">
            {incidents.map((incident) => (
              <li key={incident.id}>
                <div className="incident-heading">
                  <h3>{incident.title}</h3>
                  <span className="badge">{incident.status}</span>
                </div>
                <p className="muted">
                  {incident.serviceName} ·{" "}
                  {new Date(incident.createdAt).toLocaleString()}
                </p>
                {incident.description && (
                  <p className="description">{incident.description}</p>
                )}
                <button
                  type="button"
                  disabled={updatingIncident}
                  onClick={() => setSelectedIncidentId(incident.id)}
                >
                  View details
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {selectedIncidentId && (
        <QueryBoundary
          key={selectedIncidentId}
          loading="Loading incident details..."
        >
          <IncidentDetails
            organizationId={organizationId}
            incidentId={selectedIncidentId}
            onClose={() => setSelectedIncidentId("")}
          />
        </QueryBoundary>
      )}
    </>
  );
}

function OrganizationWorkspace() {
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const organizationsQuery = useSuspenseQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) =>
      api<Organization[]>("/api/organizations", { signal }),
  });
  const organizations = organizationsQuery.data;
  const organizationId = organizations.some(
    (organization) => organization.id === selectedOrganizationId,
  )
    ? selectedOrganizationId
    : (organizations[0]?.id ?? "");
  const busy = useIsMutating() > 0;

  return (
    <>
      <header>
        <div>
          <h1>OpsFlow</h1>
          <p>Track incidents affecting your services.</p>
        </div>
        <div>
          <label htmlFor="organization">Organization</label>
          <select
            id="organization"
            value={organizationId}
            disabled={busy || organizations.length === 0}
            onChange={(event) => setSelectedOrganizationId(event.target.value)}
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </div>
      </header>
      {organizationsQuery.error && (
        <p className="error" role="alert">
          {organizationsQuery.error.message}
        </p>
      )}
      {organizations.length === 0 && <p>No organizations available.</p>}
      {organizationId && (
        <QueryBoundary key={organizationId} loading="Loading workspace...">
          <Workspace organizationId={organizationId} />
        </QueryBoundary>
      )}
    </>
  );
}

function App() {
  return (
    <main>
      <QueryBoundary loading="Loading organizations...">
        <OrganizationWorkspace />
      </QueryBoundary>
    </main>
  );
}

export default App;
