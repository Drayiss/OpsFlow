using Microsoft.EntityFrameworkCore;
using OpsFlow.Api.Data;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
builder.Services.AddDbContext<OpsFlowDbContext>(options =>
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("OpsFlow")
            ?? throw new InvalidOperationException("Configure ConnectionStrings:OpsFlow.")
    )
);

var app = builder.Build();
app.UseExceptionHandler();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    // Local convenience only. Deployment migrations will be applied separately.
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<OpsFlowDbContext>().Database.MigrateAsync();
}

// Organization IDs scope data but do not authorize access. Authentication
// and membership checks belong to the next milestone.
app.MapGet(
    "/api/organizations",
    async (OpsFlowDbContext db, CancellationToken ct) =>
        Results.Ok(
            await db
                .Organizations.AsNoTracking()
                .OrderBy(x => x.Name)
                .Select(x => new { x.Id, x.Name })
                .ToListAsync(ct)
        )
);

app.MapGet(
    "/api/organizations/{organizationId:guid}/services",
    async (Guid organizationId, OpsFlowDbContext db, CancellationToken ct) =>
    {
        if (!await db.Organizations.AnyAsync(x => x.Id == organizationId, ct))
            return Results.NotFound();
        return Results.Ok(
            await db
                .Services.AsNoTracking()
                .Where(x => x.OrganizationId == organizationId)
                .OrderBy(x => x.Name)
                .Select(x => new
                {
                    x.Id,
                    x.Name,
                    x.OwnerName,
                })
                .ToListAsync(ct)
        );
    }
);

app.MapGet(
    "/api/organizations/{organizationId:guid}/incidents",
    async (Guid organizationId, OpsFlowDbContext db, CancellationToken ct) =>
    {
        if (!await db.Organizations.AnyAsync(x => x.Id == organizationId, ct))
            return Results.NotFound();
        return Results.Ok(
            await db
                .Incidents.AsNoTracking()
                .Where(x => x.OrganizationId == organizationId)
                .OrderByDescending(x => x.CreatedAt)
                .ThenBy(x => x.Id)
                .Take(100)
                .Select(x => new
                {
                    x.Id,
                    x.OrganizationId,
                    x.ServiceId,
                    ServiceName = x.Service.Name,
                    x.Title,
                    x.Description,
                    x.Status,
                    x.CreatedAt,
                    x.UpdatedAt,
                })
                .ToListAsync(ct)
        );
    }
);

app.MapPost(
    "/api/organizations/{organizationId:guid}/incidents",
    async (
        Guid organizationId,
        CreateIncident request,
        OpsFlowDbContext db,
        CancellationToken ct
    ) =>
    {
        var title = request.Title?.Trim() ?? "";
        var description = request.Description?.Trim() ?? "";
        var errors = new Dictionary<string, string[]>();
        if (title.Length is < 1 or > 200)
            errors["title"] = ["Title must contain 1 to 200 characters."];
        if (description.Length > 4000)
            errors["description"] = ["Description must contain at most 4000 characters."];
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);
        if (!await db.Organizations.AnyAsync(x => x.Id == organizationId, ct))
            return Results.NotFound();
        if (
            !await db.Services.AnyAsync(
                x => x.Id == request.ServiceId && x.OrganizationId == organizationId,
                ct
            )
        )
            return Results.ValidationProblem(
                new Dictionary<string, string[]>
                {
                    ["serviceId"] = ["Choose a service belonging to this organization."],
                }
            );

        var now = DateTimeOffset.UtcNow;
        var incident = new Incident
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            ServiceId = request.ServiceId,
            Title = title,
            Description = description,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Incidents.Add(incident);
        db.IncidentEvents.Add(
            new IncidentEvent
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                IncidentId = incident.Id,
                EventType = "Created",
                Note = "Incident created",
                NewStatus = "Open",
                CreatedAt = now,
            }
        );
        // One transaction keeps the incident and first timeline event together.
        await db.SaveChangesAsync(ct);
        return Results.Json(
            new
            {
                incident.Id,
                incident.OrganizationId,
                incident.ServiceId,
                incident.Title,
                incident.Description,
                incident.Status,
                incident.CreatedAt,
                incident.UpdatedAt,
            },
            statusCode: StatusCodes.Status201Created
        );
    }
);

app.MapGet(
    "/api/organizations/{organizationId:guid}/incidents/{incidentId:guid}",
    async (Guid organizationId, Guid incidentId, OpsFlowDbContext db, CancellationToken ct) =>
    {
        var incident = await db
            .Incidents.AsNoTracking()
            .Where(x => x.OrganizationId == organizationId && x.Id == incidentId)
            .Select(x => new
            {
                x.Id,
                x.OrganizationId,
                x.ServiceId,
                ServiceName = x.Service.Name,
                x.Title,
                x.Description,
                x.Status,
                x.CreatedAt,
                x.UpdatedAt,
            })
            .SingleOrDefaultAsync(ct);

        if (incident is null)
            return Results.NotFound();

        var events = await db
            .IncidentEvents.AsNoTracking()
            .Where(x => x.OrganizationId == organizationId && x.IncidentId == incidentId)
            .OrderBy(x => x.CreatedAt)
            .ThenBy(x => x.Id)
            .Select(x => new
            {
                x.Id,
                x.EventType,
                x.Note,
                x.PreviousStatus,
                x.NewStatus,
                x.CreatedAt,
            })
            .ToListAsync(ct);

        return Results.Ok(
            new
            {
                incident.Id,
                incident.OrganizationId,
                incident.ServiceId,
                incident.ServiceName,
                incident.Title,
                incident.Description,
                incident.Status,
                incident.CreatedAt,
                incident.UpdatedAt,
                Events = events,
            }
        );
    }
);

app.MapPatch(
    "/api/organizations/{organizationId:guid}/incidents/{incidentId:guid}/status",
    async (
        Guid organizationId,
        Guid incidentId,
        UpdateIncidentStatus request,
        OpsFlowDbContext db,
        CancellationToken ct
    ) =>
    {
        string[] allowedStatuses = ["Open", "Investigating", "Resolved"];

        if (
            !allowedStatuses.Contains(request.Status)
            || !allowedStatuses.Contains(request.ExpectedStatus)
        )
        {
            return Results.ValidationProblem(
                new Dictionary<string, string[]>
                {
                    ["status"] = ["Status must be Open, Investigating, or Resolved."],
                }
            );
        }

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        var incident = await db
            .Incidents.AsNoTracking()
            .SingleOrDefaultAsync(
                x => x.OrganizationId == organizationId && x.Id == incidentId,
                ct
            );

        if (incident is null)
            return Results.NotFound();

        if (incident.Status != request.ExpectedStatus)
        {
            return Results.Conflict(
                new
                {
                    Detail = "The status changed since you loaded this incident. Review the updated status and try again.",
                }
            );
        }

        // Selecting the current status should not create another event.
        if (incident.Status == request.Status)
            return Results.Ok(new { incident.Status });

        var now = DateTimeOffset.UtcNow;

        // Only update if the status is still the one the browser saw.
        var updated = await db
            .Incidents.Where(x =>
                x.OrganizationId == organizationId
                && x.Id == incidentId
                && x.Status == request.ExpectedStatus
            )
            .ExecuteUpdateAsync(
                setters =>
                    setters
                        .SetProperty(x => x.Status, request.Status!)
                        .SetProperty(x => x.UpdatedAt, now),
                ct
            );

        if (updated == 0)
        {
            return Results.Conflict(
                new
                {
                    Detail = "Another request changed this incident. Review the updated status and try again.",
                }
            );
        }

        db.IncidentEvents.Add(
            new IncidentEvent
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                IncidentId = incidentId,
                EventType = "StatusChanged",
                Note = $"Status changed from {incident.Status} to {request.Status}",
                PreviousStatus = incident.Status,
                NewStatus = request.Status,
                CreatedAt = now,
            }
        );

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return Results.Ok(new { Status = request.Status });
    }
);

app.Run();

record CreateIncident(Guid ServiceId, string? Title, string? Description);

record UpdateIncidentStatus(string? Status, string? ExpectedStatus);
