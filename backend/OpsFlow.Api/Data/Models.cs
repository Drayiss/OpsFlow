namespace OpsFlow.Api.Data;

public class Organization
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
}

public class Service
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public required string Name { get; set; }
    public required string OwnerName { get; set; }
}

public class Incident
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid ServiceId { get; set; }
    public required string Title { get; set; }
    public required string Description { get; set; }
    public string Status { get; set; } = "Open";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Service Service { get; set; } = null!;
}

public class IncidentEvent
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid IncidentId { get; set; }
    public required string EventType { get; set; }
    public required string Note { get; set; }
    public string? PreviousStatus { get; set; }
    public string? NewStatus { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
