# pie-plan-hash: 6256a5f3cf8f
Feature: Todo Task Management

  Background:
    Given the application is accessible at http://127.0.0.1:5173/todo-app/

  @id:sc-req-1-happy-path @req:REQ-1 @happy-path @explicit-requirement
  Scenario: Users can enter a new task title in "Add a New Task" and click "Create" to ad... (happy-path)
    Given the application is accessible at http://127.0.0.1:5173/todo-app/
    When the user executes the primary flow for "Users can enter a new task title in "Add a New Task" and click "Create" to ad..."
    Then Users can enter a new task title in "Add a New Task" and click "Create" to add it to the task list.

  @id:sc-req-1-persistence @req:REQ-1 @persistence @source-derived
  Scenario: Users can enter a new task title in "Add a New Task" and click "Create" to ad... (persistence)
    Given the user has completed "Users can enter a new task title in "Add a New Task" and click "Create" to ad..."
    When the browser page is reloaded
    Then the updated state remains visible after reload

  @id:sc-req-2-happy-path @req:REQ-2 @happy-path @explicit-requirement
  Scenario: Submitting an empty task title is ignored without adding blank tasks. (happy-path)
    Given the application is accessible at http://127.0.0.1:5173/todo-app/
    When the user executes the primary flow for "Submitting an empty task title is ignored without adding blank tasks."
    Then Submitting an empty task title is ignored without adding blank tasks.

  @id:sc-req-2-validation @req:REQ-2 @validation @explicit-requirement
  Scenario: Submitting an empty task title is ignored without adding blank tasks. (validation)
    Given the application is accessible at http://127.0.0.1:5173/todo-app/
    When the user submits invalid or empty input for "Submitting an empty task title is ignored without adding blank tasks."
    Then the application rejects invalid submission and preserves valid state

  @id:sc-req-2-persistence @req:REQ-2 @persistence @source-derived
  Scenario: Submitting an empty task title is ignored without adding blank tasks. (persistence)
    Given the user has completed "Submitting an empty task title is ignored without adding blank tasks."
    When the browser page is reloaded
    Then the updated state remains visible after reload

  @id:sc-req-3-happy-path @req:REQ-3 @happy-path @explicit-requirement
  Scenario: Users can mark tasks completed, delete tasks, and existing tasks persist in l... (happy-path)
    Given the application is accessible at http://127.0.0.1:5173/todo-app/
    When the user executes the primary flow for "Users can mark tasks completed, delete tasks, and existing tasks persist in l..."
    Then Users can mark tasks completed, delete tasks, and existing tasks persist in localStorage across page reload.

  @id:sc-req-3-persistence @req:REQ-3 @persistence @explicit-requirement
  Scenario: Users can mark tasks completed, delete tasks, and existing tasks persist in l... (persistence)
    Given the user has completed "Users can mark tasks completed, delete tasks, and existing tasks persist in l..."
    When the browser page is reloaded
    Then the updated state remains visible after reload

  @id:sc-req-3-state-transition @req:REQ-3 @state-transition @explicit-requirement
  Scenario: Users can mark tasks completed, delete tasks, and existing tasks persist in l... (state-transition)
    Given initial state for "Users can mark tasks completed, delete tasks, and existing tasks persist in l..." is established
    When the user performs the state transition in "Users can mark tasks completed, delete tasks, and existing tasks persist in l..."
    Then the UI indicators and counters reflect the new state cleanly
