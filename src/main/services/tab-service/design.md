# Tabs Service v2

## Singleton Instances

- TabService - The main service for the tabs controller. Manages a map of all the tabs, tab groups, and tab layouts.
- TabPersistenceService - This service is responsible for saving and restoring the tabs to the database.

## Single Instances

- Tab - A single tab in the browser
- TabLayoutNode - Contains tabs that are displayed together
- TabGroup - A group of tabs (like a folder)

## Collections Instances

- TabLayout - One per window. Holds all the tab layout nodes for that window. One layout node (or nothing) shows at one time.
- TabPositioner - Each TabLayout will have a TabPositioner, and multiple TabLayout will share the same TabPositioner in Sync Tabs mode. This has two lists: unsorted and sorted.

## QnA

Q: How are ephemeral tabs handled?
A: Tabs has an `ephemeral` property which is true if the tab is ephemeral.

Q: How are tabs saved to the database?
A: Tabs has a getSerializedState method that returns a JSON object that can be saved to the database.

Q: How are tabs objects for pinned tabs handled?
A: They are set to ephemeral and linked to a pinned tab.
