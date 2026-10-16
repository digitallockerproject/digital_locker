export const initialDocuments = [
  { id: 'transcript', name: 'Spring transcript.pdf', category: 'Academic', size: '1.2 MB', sizeMb: 1.2, status: 'Clean', date: 'Oct 15, 2026', extension: 'PDF' },
  { id: 'lease', name: 'Apartment lease.pdf', category: 'Housing', size: '2.4 MB', sizeMb: 2.4, status: 'Clean', date: 'Oct 14, 2026', extension: 'PDF' },
  { id: 'student-id', name: 'Student ID.png', category: 'Personal', size: '840 KB', sizeMb: .84, status: 'Clean', date: 'Oct 13, 2026', extension: 'PNG' },
  { id: 'aid', name: 'Financial aid letter.pdf', category: 'Financial', size: '620 KB', sizeMb: .62, status: 'Clean', date: 'Oct 12, 2026', extension: 'PDF' },
  { id: 'tax', name: 'Tax form attachment.pdf', category: 'Financial', size: '1.8 MB', sizeMb: 1.8, status: 'Flagged', date: 'Oct 11, 2026', extension: 'PDF' },
  { id: 'scholarship', name: 'Scholarship application.pdf', category: 'Academic', size: '930 KB', sizeMb: .93, status: 'Quarantined', date: 'Oct 10, 2026', extension: 'PDF' },
];
export const initialLinks = [
  { id: 'link-1', documentId: 'transcript', recipient: 'Scholarship office', expires: 'Oct 22, 2026', views: 2, maxViews: 5, status: 'Active' },
  { id: 'link-2', documentId: 'lease', recipient: 'Landlord', expires: 'Oct 20, 2026', views: 1, maxViews: 3, status: 'Active' },
  { id: 'link-3', documentId: 'aid', recipient: 'University advisor', expires: 'Oct 12, 2026', views: 3, maxViews: 3, status: 'Expired' },
];
export const initialActivity = [
  { id: 'a1', icon: 'eye', title: 'Spring transcript.pdf was viewed', detail: 'Scholarship office · sample shared link', time: 'Today, 10:42 AM' },
  { id: 'a2', icon: 'shield', title: 'Spring transcript.pdf passed its scan', detail: 'Example clean result · ready to share', time: 'Yesterday, 3:18 PM' },
  { id: 'a3', icon: 'link', title: 'A sharing link was created', detail: 'Apartment lease.pdf · limited to 3 views', time: 'Oct 14, 4:30 PM' },
  { id: 'a4', icon: 'alert', title: 'Tax form attachment.pdf was flagged', detail: 'Example warning · sharing is unavailable', time: 'Oct 11, 11:06 AM' },
];
export const categories = ['Academic', 'Housing', 'Personal', 'Financial'];
