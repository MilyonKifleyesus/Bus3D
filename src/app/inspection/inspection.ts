import { Component, OnInit, ElementRef, ViewChild, AfterViewInit, signal, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { InspectionService } from './inspection.service';
import { ThreeSceneService } from './three-scene.service';
import { HOTSPOT_CONFIGS } from './hotspot-config';
import { ZoneStatusType } from './types';
import { animate } from 'motion';

@Component({
  selector: 'app-inspection',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatChipsModule
  ],
  providers: [ThreeSceneService],
  templateUrl: './inspection.html',
  styleUrl: './inspection.css'
})
export class InspectionComponent implements OnInit, AfterViewInit {
  @ViewChild('canvasContainer') canvasContainer!: ElementRef<HTMLDivElement>;

  public inspectionService = inject(InspectionService);
  private threeService = inject(ThreeSceneService);
  private route = inject(ActivatedRoute);

  selectedHotspotId = signal<string | null>(null);
  hoveredHotspotId = signal<string | null>(null);
  mousePosition = signal<{ x: number, y: number }>({ x: 0, y: 0 });
  is3dFailed = signal<boolean>(false);
  isIntroActive = signal<boolean>(true);
  loadingProgress = signal<number>(0);
  isLoading = signal<boolean>(true);
  sidebarTab = signal<'zones' | 'timeline'>('zones');
  zoneStatuses: ZoneStatusType[] = ['not_started', 'in_review', 'passed', 'failed', 'needs_recheck'];
  
  // Counter signals
  ticketCount = signal(0);
  snagCount = signal(0);
  criticalCount = signal(0);
  warningCount = signal(0);
  
  // Modal States
  showTicketModal = signal<boolean>(false);
  showSnagModal = signal<boolean>(false);
  
  // Form Data
  ticketForm = {
    description: '',
    safetyCritical: false,
    repeated: false
  };
  
  snagForm = {
    description: '',
    category: '',
    safetyCritical: false
  };

  hotspots = this.inspectionService.hotspotStatuses;
  timeline = this.inspectionService.timeline;

  summaryStats = computed(() => {
    const tks = this.inspectionService.tickets();
    const sngs = this.inspectionService.snags();
    const statuses = this.inspectionService.hotspotStatuses();
    
    const allIssues = [...tks, ...sngs];
    const completedZones = statuses.filter(s => s.status === 'passed' || s.status === 'failed').length;
    
    return {
      tickets: tks.length,
      snags: sngs.length,
      safetyCritical: allIssues.filter(i => i.safetyCritical).length,
      repeaters: tks.filter(t => t.repeated).length + sngs.filter(s => s.repeater).length,
      zonesCompleted: completedZones,
      zonesRemaining: statuses.length - completedZones,
      progress: this.inspectionService.inspectionProgress()
    };
  });

  constructor() {
    // Effect to animate counters when stats change
    effect(() => {
      const stats = this.summaryStats();
      this.animateCounter('ticketCount', stats.tickets);
      this.animateCounter('snagCount', stats.snags);
      this.animateCounter('criticalCount', stats.safetyCritical);
      this.animateCounter('warningCount', stats.repeaters);
    });
  }

  private animateCounter(signalName: 'ticketCount' | 'snagCount' | 'criticalCount' | 'warningCount', targetValue: number) {
    let currentSignal: { set: (v: number) => void, (): number };
    switch(signalName) {
      case 'ticketCount': currentSignal = this.ticketCount; break;
      case 'snagCount': currentSignal = this.snagCount; break;
      case 'criticalCount': currentSignal = this.criticalCount; break;
      case 'warningCount': currentSignal = this.warningCount; break;
    }
    
    const startValue = currentSignal();
    if (startValue === targetValue) return;

    animate(startValue, targetValue, {
      duration: 1.0,
      ease: "easeOut",
      onUpdate: (latest: number) => {
        currentSignal.set(Math.round(latest));
      }
    });
  }

  selectedHotspotConfig = computed(() => 
    HOTSPOT_CONFIGS.find(c => c.id === this.selectedHotspotId())
  );

  hoveredHotspot = computed(() => {
    const id = this.hoveredHotspotId();
    if (!id) return null;
    const config = HOTSPOT_CONFIGS.find(c => c.id === id);
    const status = this.inspectionService.hotspotStatuses().find(s => s.id === id);
    return config && status ? { 
      ...config, 
      status: status.status,
      ticketCount: status.ticketCount,
      snagCount: status.snagCount
    } : null;
  });

  selectedHotspotTickets = computed(() => {
    const config = this.selectedHotspotConfig();
    if (!config) return [];
    return this.inspectionService.tickets().filter(t => 
      config.ticketDefectLocations.includes(t.defectLocationName)
    );
  });

  selectedHotspotSnags = computed(() => {
    const config = this.selectedHotspotConfig();
    if (!config) return [];
    return this.inspectionService.snags().filter(s => 
      config.snagCategories.includes(s.finalInspectionCategoryName)
    );
  });

  selectedHotspotData = computed(() => {
    const id = this.selectedHotspotId();
    if (!id) return null;
    return this.inspectionService.hotspotStatuses().find(s => s.id === id);
  });

  selectedHotspotChecklist = computed(() => {
    const config = this.selectedHotspotConfig();
    const id = this.selectedHotspotId();
    if (!config || !id) return [];
    const zoneData = this.inspectionService.zoneData()[id] || { checklist: {} };
    return (config.checklist || []).map(item => ({
      ...item,
      completed: !!zoneData.checklist[item.id]
    }));
  });

  ngOnInit() {
    const id = this.route.snapshot.params['id'] || 2838;
    const projectId = 2838; // Mock project ID
    this.inspectionService.loadInspectionData(Number(id), projectId);

    this.threeService.hotspotClicked.subscribe(id => {
      this.selectedHotspotId.set(id);
    });

    this.threeService.hotspotHovered.subscribe(id => {
      this.hoveredHotspotId.set(id);
    });

    this.threeService.modelLoadError.subscribe(() => {
      this.is3dFailed.set(true);
      this.isLoading.set(false);
    });

    this.threeService.loadingProgress.subscribe(progress => {
      this.loadingProgress.set(progress);
      if (progress >= 100) {
        setTimeout(() => this.isLoading.set(false), 500);
      }
    });

    this.threeService.introComplete.subscribe(() => {
      this.isIntroActive.set(false);
    });
  }

  ngAfterViewInit() {
    // Small delay to ensure container is rendered
    setTimeout(() => {
      if (this.canvasContainer) {
        this.threeService.init(this.canvasContainer);
        
        // Track mouse position for tooltip
        this.canvasContainer.nativeElement.addEventListener('mousemove', (e) => {
          this.mousePosition.set({ x: e.clientX, y: e.clientY });
        });
      }
    }, 100);
  }

  selectHotspot(id: string) {
    this.selectedHotspotId.set(id);
    const config = HOTSPOT_CONFIGS.find(c => id === c.id);
    if (config) {
      this.threeService.setCameraPreset(config.cameraPreset);
    }
  }

  setCamera(preset: string) {
    this.threeService.setCameraPreset(preset);
  }

  toggleNightMode() {
    this.threeService.toggleNightMode();
  }

  isNightMode() {
    return this.threeService.getNightMode();
  }

  toggleDoor(mode: 'full' | 'half' | 'close' = 'full') {
    const id = this.selectedHotspotId();
    if (id) {
      this.threeService.toggleDoor(id, mode);
    }
  }

  toggleLock() {
    const id = this.selectedHotspotId();
    if (id) {
      this.threeService.toggleLock(id);
    }
  }

  getDoorState() {
    const id = this.selectedHotspotId();
    return id ? this.threeService.getDoorState(id) : null;
  }

  isDoorHotspot() {
    const id = this.selectedHotspotId();
    return id === 'front' || id === 'curb_side';
  }

  updateZoneStatus(status: ZoneStatusType) {
    const id = this.selectedHotspotId();
    if (id) {
      this.inspectionService.updateZoneStatus(id, status);
    }
  }

  toggleChecklistItem(itemId: string) {
    const id = this.selectedHotspotId();
    if (id) {
      this.inspectionService.toggleChecklistItem(id, itemId);
    }
  }

  raiseTicket() {
    this.showTicketModal.set(true);
  }

  submitTicket() {
    const id = this.selectedHotspotId();
    const config = this.selectedHotspotConfig();
    if (id && config) {
      this.inspectionService.addTicket({
        ticketDescription: this.ticketForm.description,
        projectId: 2838,
        vehicleId: 2838,
        defectLocationId: 1,
        defectLocationName: config.ticketDefectLocations[0],
        stationName: 'Station 04',
        statusTicketName: 'open',
        assignedById: 44,
        assignedByName: 'M. Kifleyesus',
        assignedToId: 44,
        assignedToName: 'M. Kifleyesus',
        safetyCritical: this.ticketForm.safetyCritical,
        repeated: this.ticketForm.repeated,
        hasImages: false,
        imageUrl: ''
      });
      this.closeModals();
    }
  }

  addSnag() {
    this.showSnagModal.set(true);
  }

  submitSnag() {
    const id = this.selectedHotspotId();
    const config = this.selectedHotspotConfig();
    if (id && config) {
      this.inspectionService.addSnag({
        projectId: 2838,
        vehicleId: 2838,
        finalInspectionCategory: 1,
        finalInspectionCategoryName: config.snagCategories[0],
        description: this.snagForm.description,
        userId: 44,
        userName: 'M. Kifleyesus',
        safetyCritical: this.snagForm.safetyCritical,
        repeater: false,
        hasImages: false,
        imageCount: 0
      });
      this.closeModals();
    }
  }

  closeModals() {
    this.showTicketModal.set(false);
    this.showSnagModal.set(false);
    this.ticketForm = { description: '', safetyCritical: false, repeated: false };
    this.snagForm = { description: '', category: '', safetyCritical: false };
  }

  markClear() {
    const id = this.selectedHotspotId();
    if (id) {
      this.inspectionService.updateZoneStatus(id, 'passed');
    }
  }

  markFailed() {
    const id = this.selectedHotspotId();
    if (id) {
      this.inspectionService.updateZoneStatus(id, 'failed');
    }
  }

  addNote() {
    const id = this.selectedHotspotId();
    if (id) {
      console.log('Adding note to zone:', id);
    }
  }

  uploadPhoto() {
    const id = this.selectedHotspotId();
    if (id) {
      console.log('Uploading photo to zone:', id);
    }
  }

  saveDraft() {
    console.log('Saving inspection draft...');
  }

  markComplete() {
    console.log('Marking inspection as complete...');
  }

  getStatusColor(color: string): string {
    switch (color) {
      case 'red': return 'bg-[#CC0000] text-white';
      case 'amber': return 'bg-[#E07800] text-white';
      case 'neutral': return 'bg-[#CCB800] text-white';
      case 'blue': return 'bg-[#1E90FF] text-white';
      default: return 'bg-[#1E90FF] text-white';
    }
  }

  getSeverityLabel(color: string): string {
    switch (color) {
      case 'red': return 'Critical';
      case 'amber': return 'Warning';
      case 'neutral': return 'Minor';
      default: return 'Minor';
    }
  }

  getZoneStatusColor(status: string): string {
    switch (status) {
      case 'passed': return 'bg-[#00CC66]';
      case 'failed': return 'bg-[#FF2222]';
      case 'in_review': return 'bg-[#1E90FF]';
      case 'needs_recheck': return 'bg-[#FFA500]';
      default: return 'bg-[#888888]';
    }
  }

  getZoneStatusLabel(status: string): string {
    switch (status) {
      case 'passed': return 'Passed';
      case 'failed': return 'Failed';
      case 'in_review': return 'In Review';
      case 'needs_recheck': return 'Recheck';
      default: return 'Not Started';
    }
  }
}
