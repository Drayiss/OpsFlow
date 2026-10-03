using Microsoft.EntityFrameworkCore;

namespace OpsFlow.Api.Data;

public class OpsFlowDbContext(DbContextOptions<OpsFlowDbContext> options) : DbContext(options)
{
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<Service> Services => Set<Service>();
    public DbSet<Incident> Incidents => Set<Incident>();
    public DbSet<IncidentEvent> IncidentEvents => Set<IncidentEvent>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        var organizations = model.Entity<Organization>();
        organizations.Property(x => x.Name).HasMaxLength(100);

        var services = model.Entity<Service>();
        services.Property(x => x.Name).HasMaxLength(100);
        services.Property(x => x.OwnerName).HasMaxLength(100);
        services.HasAlternateKey(x => new { x.OrganizationId, x.Id });
        services.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId)
            .OnDelete(DeleteBehavior.Restrict);

        var incidents = model.Entity<Incident>();
        incidents.Property(x => x.Title).HasMaxLength(200);
        incidents.Property(x => x.Description).HasMaxLength(4000);
        incidents.Property(x => x.Status).HasMaxLength(20);
        incidents.ToTable(t => t.HasCheckConstraint("CK_Incidents_Status",
            "\"Status\" IN ('Open', 'Investigating', 'Resolved')"));
        incidents.HasAlternateKey(x => new { x.OrganizationId, x.Id });
        incidents.HasIndex(x => new { x.OrganizationId, x.CreatedAt });
        incidents.HasOne(x => x.Service).WithMany()
            .HasForeignKey(x => new { x.OrganizationId, x.ServiceId })
            .HasPrincipalKey(x => new { x.OrganizationId, x.Id })
            .OnDelete(DeleteBehavior.Restrict);

        var events = model.Entity<IncidentEvent>();
        events.Property(x => x.EventType).HasMaxLength(30);
        events.Property(x => x.Note).HasMaxLength(4000);
        events.Property(x => x.PreviousStatus).HasMaxLength(20);
        events.Property(x => x.NewStatus).HasMaxLength(20);
        events.HasIndex(x => new { x.OrganizationId, x.IncidentId, x.CreatedAt });
        events.HasOne<Incident>().WithMany()
            .HasForeignKey(x => new { x.OrganizationId, x.IncidentId })
            .HasPrincipalKey(x => new { x.OrganizationId, x.Id })
            .OnDelete(DeleteBehavior.Restrict);

        var northstar = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var harbor = Guid.Parse("22222222-2222-2222-2222-222222222222");
        organizations.HasData(
            new Organization { Id = northstar, Name = "Northstar" },
            new Organization { Id = harbor, Name = "Harbor" });
        services.HasData(
            new Service { Id = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
                OrganizationId = northstar, Name = "Checkout API", OwnerName = "Alex" },
            new Service { Id = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
                OrganizationId = harbor, Name = "Customer Portal", OwnerName = "Sam" });
    }
}
