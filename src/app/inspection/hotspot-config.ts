import { HotspotConfig } from './types';

export const HOTSPOT_CONFIGS: HotspotConfig[] = [
  {
    id: 'front',
    label: 'Front',
    ticketDefectLocations: ['Front', 'Front End', 'Production'],
    snagCategories: ['Front', 'Exterior'],
    cameraPreset: 'front',
    description: 'Front mask, headlights, and windshield area.',
    checklist: [
      { id: 'f1', label: 'Windshield integrity check', completed: false },
      { id: 'f2', label: 'Headlight alignment', completed: false },
      { id: 'f3', label: 'Front bumper securement', completed: false }
    ]
  },
  {
    id: 'rear',
    label: 'Rear',
    ticketDefectLocations: ['Rear', 'Rear End'],
    snagCategories: ['Rear', 'Exterior'],
    cameraPreset: 'rear',
    description: 'Rear engine door, tail lights, and bumper.',
    checklist: [
      { id: 'r1', label: 'Engine door latch check', completed: false },
      { id: 'r2', label: 'Tail light functionality', completed: false },
      { id: 'r3', label: 'Exhaust pipe clearance', completed: false }
    ]
  },
  {
    id: 'curb_side',
    label: 'Curb Side',
    ticketDefectLocations: ['Curb Side', 'Right Side'],
    snagCategories: ['Curb Side', 'Right Side'],
    cameraPreset: 'right',
    description: 'Passenger entrance side.',
    checklist: [
      { id: 'cs1', label: 'Passenger door operation', completed: false },
      { id: 'cs2', label: 'Side reflector visibility', completed: false },
      { id: 'cs3', label: 'Wheel arch integrity', completed: false }
    ]
  },
  {
    id: 'street_side',
    label: 'Street Side',
    ticketDefectLocations: ['Street Side', 'Left Side'],
    snagCategories: ['Street Side', 'Left Side'],
    cameraPreset: 'left',
    description: 'Driver side exterior.',
    checklist: [
      { id: 'ss1', label: 'Driver window seal', completed: false },
      { id: 'ss2', label: 'Side mirror securement', completed: false },
      { id: 'ss3', label: 'Body panel alignment', completed: false }
    ]
  },
  {
    id: 'roof',
    label: 'Roof',
    ticketDefectLocations: ['Roof'],
    snagCategories: ['Roof'],
    cameraPreset: 'top',
    description: 'Roof panels, HVAC units, and antennas.',
    checklist: [
      { id: 'ro1', label: 'HVAC unit securement', completed: false },
      { id: 'ro2', label: 'Roof panel sealing', completed: false },
      { id: 'ro3', label: 'Antenna mounting', completed: false }
    ]
  },
  {
    id: 'interior',
    label: 'Interior',
    ticketDefectLocations: ['Interior'],
    snagCategories: ['Interior'],
    cameraPreset: 'interior',
    description: 'Passenger seating and general interior.',
    checklist: [
      { id: 'i1', label: 'Seat securement check', completed: false },
      { id: 'i2', label: 'Interior lighting test', completed: false },
      { id: 'i3', label: 'Floor covering integrity', completed: false }
    ]
  },
  {
    id: 'driver_area',
    label: 'Driver Area',
    ticketDefectLocations: ['Driver Area', 'Dashboard'],
    snagCategories: ['Driver Area', 'Function'],
    cameraPreset: 'driver',
    description: 'Cockpit, controls, and driver seat.',
    checklist: [
      { id: 'da1', label: 'Steering wheel adjustment', completed: false },
      { id: 'da2', label: 'Dashboard display test', completed: false },
      { id: 'da3', label: 'Driver seat adjustment', completed: false }
    ]
  },
  {
    id: 'wheels_undercarriage',
    label: 'Wheels & Undercarriage',
    ticketDefectLocations: ['Wheels', 'Undercarriage', 'Chassis'],
    snagCategories: ['Wheels', 'Undercarriage'],
    cameraPreset: 'undercarriage',
    description: 'Tires, rims, and bottom components.',
    checklist: [
      { id: 'wu1', label: 'Tire pressure check', completed: false },
      { id: 'wu2', label: 'Wheel nut torque test', completed: false },
      { id: 'wu3', label: 'Undercarriage visual check', completed: false }
    ]
  }
];
