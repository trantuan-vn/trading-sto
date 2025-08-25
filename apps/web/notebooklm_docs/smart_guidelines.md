# Next.js Project Guidelines (AI-Generated)

## Project Overview

- **Framework**: Next.js with Custom Structure
- **Language**: TypeScript
- **Styling**: Tailwind CSS

## Discovered Architecture

### Key Directories Structure
- **Components**: `src/components`
- **Hooks**: `src/hooks`
- **Stores**: `src/stores`
- **Lib**: `src/lib`
- **Types**: `src/types`
- **Styles**: `src/styles`
- **App**: `src/app`

### Component Conventions
- **Location**: `src`, `src/app`, `src/app/(external)`
- **Naming**: camelCase
- **Export**: named

### State Management
- **Primary method**: useState
- **Locations**: `src/app/(main)/dashboard/_components/sidebar`, `src/app/(main)/dashboard/default/_components`, `src/components/ui`

## Recommended Development Patterns

### Component Development
- Create components in `src/components`
- Use camelCase naming convention
- Use named exports

### State Management
- Continue using useState pattern
- Place state logic in `src/stores`

### File Organization
- Follow the existing directory structure patterns
- Keep related files colocated when possible
- Use consistent naming across the project

