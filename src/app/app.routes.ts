import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'admin/vehicles/inspect/:id',
    loadComponent: () => import('./inspection/inspection').then(m => m.InspectionComponent)
  },
  {
    path: 'client/vehicles/inspect/:id',
    loadComponent: () => import('./inspection/inspection').then(m => m.InspectionComponent)
  },
  {
    path: '',
    redirectTo: 'admin/vehicles/inspect/2838',
    pathMatch: 'full'
  }
];
