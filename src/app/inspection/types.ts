export interface Vehicle {
  id: number;
  client: string;
  project: string;
  fleetNumber: string;
  make: string;
  model: string;
  vin: string;
  plate: string;
  mileageType: string;
  propulsion: string;
  active: boolean;
  status: string;
  imageUrl: string;
  inspectionDate: string;
  frameNumber: string;
  year: number;
  color: string;
  licensePlate: string;
  assignments: Assignment[];
  inspectionData: InspectionData;
}

export interface Assignment {
  assigmentId: number;
  projectId: number;
  projectName: string;
  inspectorId: number;
  inspectorName: string;
}

export interface InspectionData {
  date: string;
  duration: string;
  mileage: number;
}

export interface Ticket {
  id: number;
  ticketNumber: string;
  ticketDescription: string;
  projectId: number;
  vehicleId: number;
  defectLocationId: number;
  defectLocationName: string;
  stationName: string;
  statusTicketName: string;
  assignedById: number;
  assignedByName: string;
  assignedToId: number;
  assignedToName: string;
  safetyCritical: boolean;
  repeated: boolean;
  hasImages: boolean;
  imageUrl: string;
  createdAt: string;
}

export interface Snag {
  id: number;
  snagNumber: string;
  projectId: number;
  vehicleId: number;
  finalInspectionCategory: number;
  finalInspectionCategoryName: string;
  description: string;
  userId: number;
  userName: string;
  safetyCritical: boolean;
  repeater: boolean;
  hasImages: boolean;
  imageCount: number;
}

export interface StationTracker {
  id: number;
  vehicleId: number;
  projectId: number;
  stationId: number;
  stationNumber?: string;
  stationName: string;
  stationTypeName?: string;
  title: string;
  description: string;
  userId: number;
  userName: string;
  status?: string;
  timestamp: string;
  startDate?: string;
  endDate?: string | null;
  type: 'ticket' | 'snag' | 'status' | 'photo';
}

export type ZoneStatusType = 'not_started' | 'in_review' | 'passed' | 'failed' | 'needs_recheck';

export interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
}

export interface ZoneData {
  status: ZoneStatusType;
  checklist: Record<string, boolean>;
}

export interface HotspotConfig {
  id: string;
  label: string;
  meshNames?: string[]; // Optional: for mapping to specific 3D meshes
  ticketDefectLocations: string[];
  snagCategories: string[];
  cameraPreset: 'front' | 'rear' | 'left' | 'right' | 'top' | 'interior' | 'driver' | 'undercarriage';
  description?: string;
  checklist?: ChecklistItem[];
}

export interface HotspotStatus {
  id: string;
  label: string;
  ticketCount: number;
  snagCount: number;
  hasSafetyCritical: boolean;
  hasRepeater: boolean;
  color: 'red' | 'amber' | 'neutral' | 'blue';
  status: ZoneStatusType;
  progress: number;
}
