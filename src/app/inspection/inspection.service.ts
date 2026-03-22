import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Vehicle, Ticket, Snag, StationTracker, HotspotStatus, ZoneStatusType, ZoneData } from './types';
import { HOTSPOT_CONFIGS } from './hotspot-config';

@Injectable({
  providedIn: 'root'
})
export class InspectionService {
  private http = inject(HttpClient);
  private baseUrl = '/api';

  // Signals for state management
  vehicle = signal<Vehicle | null>(null);
  tickets = signal<Ticket[]>([]);
  snags = signal<Snag[]>([]);
  timeline = signal<StationTracker[]>([]);
  loading = signal<boolean>(false);
  error = signal<string | null>(null);

  // Dynamic zone data (status, checklist)
  zoneData = signal<Record<string, ZoneData>>({
    'front': { status: 'in_review', checklist: {} },
    'rear': { status: 'passed', checklist: {} },
    'curb_side': { status: 'failed', checklist: {} },
    'street_side': { status: 'needs_recheck', checklist: {} },
    'roof': { status: 'not_started', checklist: {} },
    'interior': { status: 'passed', checklist: {} },
    'driver_area': { status: 'in_review', checklist: {} },
    'wheels_undercarriage': { status: 'not_started', checklist: {} }
  });

  // Computed hotspot statuses based on tickets, snags, and zoneData
  hotspotStatuses = computed<HotspotStatus[]>(() => {
    const tks = this.tickets();
    const sngs = this.snags();
    const zData = this.zoneData();

    return HOTSPOT_CONFIGS.map(config => {
      const filteredTickets = tks.filter(t => 
        config.ticketDefectLocations.includes(t.defectLocationName)
      );
      const filteredSnags = sngs.filter(s => 
        config.snagCategories.includes(s.finalInspectionCategoryName)
      );

      const hasSafetyCritical = filteredTickets.some(t => t.safetyCritical) || filteredSnags.some(s => s.safetyCritical);
      const hasRepeater = filteredTickets.some(t => t.repeated) || filteredSnags.some(s => s.repeater);
      const totalIssues = filteredTickets.length + filteredSnags.length;

      let color: 'red' | 'amber' | 'neutral' | 'blue' = 'blue';
      if (hasSafetyCritical) {
        color = 'red';
      } else if (hasRepeater || totalIssues > 3) {
        color = 'amber';
      } else if (totalIssues === 0) {
        color = 'neutral';
      }

      const zoneInfo = zData[config.id] || { status: 'not_started', checklist: {} };
      
      // Calculate checklist progress
      const totalChecklist = config.checklist?.length || 0;
      const completedChecklist = config.checklist?.filter(item => zoneInfo.checklist[item.id]).length || 0;
      const progress = totalChecklist > 0 ? (completedChecklist / totalChecklist) * 100 : 0;

      return {
        id: config.id,
        label: config.label,
        ticketCount: filteredTickets.length,
        snagCount: filteredSnags.length,
        hasSafetyCritical,
        hasRepeater,
        color,
        status: zoneInfo.status,
        progress
      };
    });
  });

  // Overall inspection progress
  inspectionProgress = computed(() => {
    const statuses = this.hotspotStatuses();
    if (statuses.length === 0) return 0;
    const completedZones = statuses.filter(s => s.status === 'passed' || s.status === 'failed').length;
    return Math.round((completedZones / statuses.length) * 100);
  });

  updateZoneStatus(zoneId: string, status: ZoneStatusType) {
    this.zoneData.update(data => ({
      ...data,
      [zoneId]: {
        ...(data[zoneId] || { status: 'not_started', checklist: {} }),
        status
      }
    }));
  }

  toggleChecklistItem(zoneId: string, itemId: string) {
    this.zoneData.update(data => {
      const zone = data[zoneId] || { status: 'not_started', checklist: {} };
      return {
        ...data,
        [zoneId]: {
          ...zone,
          checklist: {
            ...zone.checklist,
            [itemId]: !zone.checklist[itemId]
          }
        }
      };
    });
  }

  addTicket(ticket: Omit<Ticket, 'id' | 'ticketNumber' | 'createdAt'>) {
    const newTicket: Ticket = {
      ...ticket,
      id: Date.now(),
      ticketNumber: `T-${Math.floor(1000 + Math.random() * 9000)}`,
      createdAt: new Date().toISOString()
    };
    this.tickets.update(tks => [newTicket, ...tks]);
    
    // Add to timeline
    this.timeline.update(tl => [{
      id: Date.now(),
      vehicleId: ticket.vehicleId,
      projectId: ticket.projectId,
      stationId: 4,
      stationName: 'Station 04',
      title: `Ticket Raised: ${newTicket.ticketNumber}`,
      description: ticket.ticketDescription,
      timestamp: new Date().toISOString(),
      userId: ticket.assignedById,
      userName: ticket.assignedByName,
      type: 'ticket'
    }, ...tl]);

    // Auto-update zone status to failed if safety critical
    if (ticket.safetyCritical) {
      this.updateZoneStatus(HOTSPOT_CONFIGS.find(c => c.ticketDefectLocations.includes(ticket.defectLocationName))?.id || '', 'failed');
    }
  }

  addSnag(snag: Omit<Snag, 'id' | 'snagNumber'>) {
    const newSnag: Snag = {
      ...snag,
      id: Date.now(),
      snagNumber: `S-${Math.floor(2000 + Math.random() * 8000)}`
    };
    this.snags.update(sngs => [newSnag, ...sngs]);

    // Add to timeline
    this.timeline.update(tl => [{
      id: Date.now(),
      vehicleId: snag.vehicleId,
      projectId: snag.projectId,
      stationId: 4,
      stationName: 'Station 04',
      title: `Snag Recorded: ${newSnag.snagNumber}`,
      description: snag.description,
      timestamp: new Date().toISOString(),
      userId: snag.userId,
      userName: snag.userName,
      type: 'snag'
    }, ...tl]);
  }

  loadInspectionData(vehicleId: number, projectId: number) {
    this.loading.set(true);
    this.error.set(null);

    // In a real app, we'd use this.http.get
    // For this demo, we'll use mock data as requested
    
    const mockVehicle: Vehicle = {
      id: vehicleId,
      client: "YRT - York Region Transit",
      project: "Commuter Fleet Expansion",
      fleetNumber: "YRT-2026-042",
      make: "Nova Bus",
      model: "LFSe+ Modern Transit",
      vin: "2NVYL82JXP00042838",
      plate: "YRT-42838",
      mileageType: "miles",
      propulsion: "Electric",
      active: true,
      status: "IN PROGRESS",
      imageUrl: "https://picsum.photos/seed/yrtbus/800/600",
      inspectionDate: "2026-03-20",
      frameNumber: "FR-42838",
      year: 2026,
      color: "Light Sky Blue",
      licensePlate: "YRT-42838",
      assignments: [
        {
          assigmentId: 101,
          projectId: projectId,
          projectName: "Commuter Fleet Expansion",
          inspectorId: 44,
          inspectorName: "M. Kifleyesus"
        }
      ],
      inspectionData: {
        date: "2026-03-20",
        duration: "02:15",
        mileage: 42
      }
    };

    const mockTickets: Ticket[] = [
      {
        id: 1,
        ticketNumber: "T-1001",
        ticketDescription: "Cracked Windshield - Front Mask",
        projectId: 2838,
        vehicleId: 2838,
        defectLocationId: 1,
        defectLocationName: "Front",
        stationName: "Station 04",
        statusTicketName: "open",
        assignedById: 12,
        assignedByName: "Lead Inspector",
        assignedToId: 44,
        assignedToName: "M. Kifleyesus",
        safetyCritical: true,
        repeated: false,
        hasImages: true,
        imageUrl: "https://picsum.photos/seed/windshield/400/300",
        createdAt: "2026-03-20T10:00:00Z"
      },
      {
        id: 2,
        ticketNumber: "T-1002",
        ticketDescription: "Brake Light Out - Left Side",
        projectId: 2838,
        vehicleId: 2838,
        defectLocationId: 2,
        defectLocationName: "Rear",
        stationName: "Station 04",
        statusTicketName: "open",
        assignedById: 12,
        assignedByName: "Lead Inspector",
        assignedToId: 44,
        assignedToName: "M. Kifleyesus",
        safetyCritical: true,
        repeated: true,
        hasImages: false,
        imageUrl: "",
        createdAt: "2026-03-20T11:00:00Z"
      },
      {
        id: 3,
        ticketNumber: "T-1003",
        ticketDescription: "Handrail Loose - Row 3",
        projectId: 2838,
        vehicleId: 2838,
        defectLocationId: 3,
        defectLocationName: "Interior",
        stationName: "Station 04",
        statusTicketName: "pending",
        assignedById: 12,
        assignedByName: "Lead Inspector",
        assignedToId: 45,
        assignedToName: "Sarah Connor",
        safetyCritical: false,
        repeated: false,
        hasImages: true,
        imageUrl: "https://picsum.photos/seed/handrail/400/300",
        createdAt: "2026-03-20T12:00:00Z"
      }
    ];

    const mockSnags: Snag[] = [
      {
        id: 21,
        snagNumber: "S-2101",
        projectId: 2838,
        vehicleId: 2838,
        finalInspectionCategory: 3,
        finalInspectionCategoryName: "Curb Side",
        description: "Door Seal Worn - Front Entrance",
        userId: 44,
        userName: "M. Kifleyesus",
        safetyCritical: false,
        repeater: true,
        hasImages: true,
        imageCount: 2
      },
      {
        id: 22,
        snagNumber: "S-2102",
        projectId: 2838,
        vehicleId: 2838,
        finalInspectionCategory: 4,
        finalInspectionCategoryName: "Street Side",
        description: "Mirror Alignment - Driver Side",
        userId: 44,
        userName: "M. Kifleyesus",
        safetyCritical: false,
        repeater: false,
        hasImages: true,
        imageCount: 1
      }
    ];

    const mockTimeline: StationTracker[] = [
      {
        id: 1,
        vehicleId: 2838,
        projectId: 2838,
        stationId: 4,
        stationName: "Station 04",
        title: "Inspection Started",
        description: "Final inspection process initiated for YRT Sky Blue fleet.",
        userId: 44,
        userName: "M. Kifleyesus",
        timestamp: "2026-03-20T08:30:00Z",
        type: 'status'
      },
      {
        id: 2,
        vehicleId: 2838,
        projectId: 2838,
        stationId: 4,
        stationName: "Station 04",
        title: "System Check Passed",
        description: "Automated diagnostics for engine and transmission systems completed with 0 errors.",
        userId: 44,
        userName: "System Auto-Check",
        timestamp: "2026-03-20T09:15:00Z",
        type: 'status'
      }
    ];

    // Simulate API delay
    setTimeout(() => {
      this.vehicle.set(mockVehicle);
      this.tickets.set(mockTickets);
      this.snags.set(mockSnags);
      this.timeline.set(mockTimeline);
      this.loading.set(false);
    }, 1000);
  }
}
