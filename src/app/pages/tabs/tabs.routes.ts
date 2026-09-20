import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const tabsRoutes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      { path: 'dzis', loadComponent: () => import('../today/today.page').then((m) => m.TodayPage) },
      { path: 'tydzien', loadComponent: () => import('../week/week.page').then((m) => m.WeekPage) },
      { path: 'ruch', loadComponent: () => import('../activity/activity.page').then((m) => m.ActivityPage) },
      { path: 'przepisy', loadComponent: () => import('../recipes/recipes.page').then((m) => m.RecipesPage) },
      { path: 'przepisy/:id', loadComponent: () => import('../recipes/recipe-detail.page').then((m) => m.RecipeDetailPage) },
      { path: 'produkt', loadComponent: () => import('../food/product-search.page').then((m) => m.ProductSearchPage) },
      { path: 'czat', loadComponent: () => import('../chat/chat.page').then((m) => m.ChatPage) },
      { path: 'profil', loadComponent: () => import('../profile/profile.page').then((m) => m.ProfilePage) },
      { path: 'profil/dane', loadComponent: () => import('../profile/profile-edit.page').then((m) => m.ProfileEditPage) },
      { path: '', pathMatch: 'full', redirectTo: 'dzis' },
    ],
  },
];
