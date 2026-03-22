import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {beforeEach, describe, expect, it} from 'vitest';
import {InspectionService} from './inspection.service';
import {HOTSPOT_CONFIGS} from './hotspot-config';

describe('InspectionService', () => {
  let service: InspectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient()],
    });

    service = TestBed.inject(InspectionService);
  });

  it('exposes a hotspot status entry for every configured inspection zone', () => {
    const statuses = service.hotspotStatuses();

    expect(statuses).toHaveLength(HOTSPOT_CONFIGS.length);
    expect(statuses.find((status) => status.id === 'front')?.status).toBe('in_review');
    expect(statuses.find((status) => status.id === 'rear')?.status).toBe('passed');
  });

  it('updates checklist progress and zone status', () => {
    service.updateZoneStatus('front', 'passed');
    service.toggleChecklistItem('front', 'f1');
    service.toggleChecklistItem('front', 'f2');

    const frontStatus = service.hotspotStatuses().find((status) => status.id === 'front');

    expect(frontStatus?.status).toBe('passed');
    expect(frontStatus?.progress).toBeCloseTo(66.666, 1);
    expect(service.inspectionProgress()).toBe(50);
  });

  it('marks the related zone as failed when a safety-critical ticket is raised', () => {
    service.addTicket({
      ticketDescription: 'Windshield crack',
      projectId: 2838,
      vehicleId: 2838,
      defectLocationId: 1,
      defectLocationName: 'Front',
      stationName: 'Station 04',
      statusTicketName: 'open',
      assignedById: 44,
      assignedByName: 'Inspector',
      assignedToId: 44,
      assignedToName: 'Inspector',
      safetyCritical: true,
      repeated: false,
      hasImages: false,
      imageUrl: '',
    });

    const frontStatus = service.hotspotStatuses().find((status) => status.id === 'front');

    expect(service.tickets()).toHaveLength(1);
    expect(frontStatus?.ticketCount).toBe(1);
    expect(frontStatus?.status).toBe('failed');
    expect(service.timeline()[0]?.type).toBe('ticket');
  });

  it('records snags and prepends them to the activity timeline', () => {
    service.addSnag({
      projectId: 2838,
      vehicleId: 2838,
      finalInspectionCategory: 1,
      finalInspectionCategoryName: 'Curb Side',
      description: 'Door seal worn',
      userId: 44,
      userName: 'Inspector',
      safetyCritical: false,
      repeater: true,
      hasImages: false,
      imageCount: 0,
    });

    const curbSideStatus = service.hotspotStatuses().find((status) => status.id === 'curb_side');

    expect(service.snags()).toHaveLength(1);
    expect(curbSideStatus?.snagCount).toBe(1);
    expect(curbSideStatus?.hasRepeater).toBe(true);
    expect(service.timeline()[0]?.type).toBe('snag');
  });
});
