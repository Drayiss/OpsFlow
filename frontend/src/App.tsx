import { Suspense, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { QueryErrorResetBoundary, useIsMutating, useMutation, useSuspenseQueries, useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorBoundary } from 'react-error-boundary'
import './App.css'

type Organization = { id: string; name: string }
type Service = { id: string; name: string; ownerName: string }
type Incident = {
  id: string; title: string; description: string; serviceName: string
  status: string; createdAt: string
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    const problem = await response.json().catch(() => null)
    const messages = problem?.errors
      ? Object.values(problem.errors).flat().join(' ')
      : `Request failed (${response.status}). Check that the API and database are running.`
    throw new Error(messages)
  }
  return response.json() as Promise<T>
}

function QueryBoundary({ children, loading }: { children: ReactNode; loading: string }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary onReset={reset} fallbackRender={({ error, resetErrorBoundary }) => (
          <section className="panel">
            <p className="error" role="alert">
              {error instanceof Error ? error.message : 'Something went wrong.'}
            </p>
            <button type="button" onClick={resetErrorBoundary}>Try again</button>
          </section>
        )}>
          <Suspense fallback={<p role="status">{loading}</p>}>
            {children}
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}

function Workspace({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient()
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const base = `/api/organizations/${organizationId}`
  // Start both requests together instead of suspending on each in sequence.
  const [servicesQuery, incidentsQuery] = useSuspenseQueries({
    queries: [
      {
        queryKey: ['services', organizationId],
        queryFn: ({ signal }) => api<Service[]>(`${base}/services`, { signal }),
      },
      {
        queryKey: ['incidents', organizationId],
        queryFn: ({ signal }) => api<Incident[]>(`${base}/incidents`, { signal }),
      },
    ],
  })
  const services = servicesQuery.data
  const incidents = incidentsQuery.data
  const serviceId = services.some(service => service.id === selectedServiceId)
    ? selectedServiceId : services[0]?.id ?? ''

  const createMutation = useMutation({
    mutationKey: ['createIncident', organizationId],
    mutationFn: (input: { serviceId: string; title: string; description: string }) =>
      api<{ id: string }>(`${base}/incidents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      setTitle('')
      setDescription('')
      // Refresh only this organization's list from the source of truth.
      await queryClient.invalidateQueries({ queryKey: ['incidents', organizationId], exact: true })
    },
  })

  function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (createMutation.isPending) return
    createMutation.mutate({ serviceId, title, description })
  }

  return (
    <>
      {servicesQuery.error && <p className="error" role="alert">{servicesQuery.error.message}</p>}
      {incidentsQuery.error && <p className="error" role="alert">{incidentsQuery.error.message}</p>}
      {createMutation.error && <p className="error" role="alert">{createMutation.error.message}</p>}
      {createMutation.isSuccess && <p className="notice" role="status">Incident created.</p>}
      <section className="panel">
        <h2>Create incident</h2>
        <form onSubmit={createIncident}>
          <fieldset disabled={createMutation.isPending || services.length === 0}>
            <label htmlFor="service">Affected service</label>
            <select id="service" value={serviceId} onChange={event => setSelectedServiceId(event.target.value)} required>
              {services.map(service => <option key={service.id} value={service.id}>
                {service.name} (owner: {service.ownerName})
              </option>)}
            </select>
            <label htmlFor="title">Title</label>
            <input id="title" value={title} onChange={event => setTitle(event.target.value)}
              required maxLength={200} placeholder="Checkout API is returning errors" />
            <label htmlFor="description">Description</label>
            <textarea id="description" value={description} onChange={event => setDescription(event.target.value)}
              maxLength={4000} rows={3} />
            <button type="submit" disabled={!title.trim()}>{createMutation.isPending ? 'Creating...' : 'Create incident'}</button>
          </fieldset>
        </form>
      </section>
      <section className="panel">
        <h2>Incidents</h2>
        <p className="muted">Latest 100 incidents in this organization.</p>
        {incidents.length === 0 ? <p>No incidents yet.</p>
          : <ul className="incidents">{incidents.map(incident => (
            <li key={incident.id}>
              <div className="incident-heading"><h3>{incident.title}</h3><span className="badge">{incident.status}</span></div>
              <p className="muted">{incident.serviceName} · {new Date(incident.createdAt).toLocaleString()}</p>
              {incident.description && <p className="description">{incident.description}</p>}
            </li>
          ))}</ul>}
      </section>
    </>
  )
}

function OrganizationWorkspace() {
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const organizationsQuery = useSuspenseQuery({
    queryKey: ['organizations'],
    queryFn: ({ signal }) => api<Organization[]>('/api/organizations', { signal }),
  })
  const organizations = organizationsQuery.data
  const organizationId = organizations.some(organization => organization.id === selectedOrganizationId)
    ? selectedOrganizationId : organizations[0]?.id ?? ''
  const busy = useIsMutating({ mutationKey: ['createIncident'] }) > 0

  return (
    <>
      <header><div><h1>OpsFlow</h1><p>Track incidents affecting your services.</p></div>
        <div><label htmlFor="organization">Organization</label>
          <select id="organization" value={organizationId} disabled={busy || organizations.length === 0}
            onChange={event => setSelectedOrganizationId(event.target.value)}>
            {organizations.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
          </select>
        </div>
      </header>
      {organizationsQuery.error && <p className="error" role="alert">{organizationsQuery.error.message}</p>}
      {organizations.length === 0 && <p>No organizations available.</p>}
      {organizationId && (
        <QueryBoundary key={organizationId} loading="Loading workspace...">
          <Workspace organizationId={organizationId} />
        </QueryBoundary>
      )}
    </>
  )
}

function App() {
  return (
    <main>
      <QueryBoundary loading="Loading organizations...">
        <OrganizationWorkspace />
      </QueryBoundary>
    </main>
  )
}

export default App
