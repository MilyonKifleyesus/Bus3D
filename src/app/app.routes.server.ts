import {RenderMode, ServerRoute} from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'admin/vehicles/inspect/:id',
    renderMode: RenderMode.Server,
  },
  {
    path: 'client/vehicles/inspect/:id',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
