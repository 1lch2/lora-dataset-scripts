export interface ReviewFields {
  group: string;
  search: string;
  kind: string;
  hasTag: string;
  notTag: string;
  hasLogic: string;
  notLogic: string;
  tagSearch: string;
  tagSearchMode: string;
  tagSort: string;
  tagOrder: string;
  editScope: string;
  tagOperation: string;
  editTags: string;
  oldTag: string;
  newTag: string;
  matchSearch: string;
  matchReplacement: string;
  matchMode: string;
  captionSort: string;
  captionOrder: string;
  frequencySearch: string;
  frequencySearchMode: string;
  frequencySort: string;
  frequencyOrder: string;
  singleCaption: string;
  dropTags: string;
  scale: string;
  person: string;
}

export type FieldName = keyof ReviewFields;
