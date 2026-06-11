# Makefile for ghwm-marketplace

# Configuration
UI_DIR = src/ui

.PHONY: help setup dev build preview clean

# Default target
all: help

## help: Show this help message
help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "Available targets:"
	@echo "  setup       Install dependencies for the Astro UI and other scripts"
	@echo "  dev         Start the Astro UI development server"
	@echo "  build       Build the Astro UI for production"
	@echo "  preview     Preview the production build locally"
	@echo "  clean       Clean build outputs and temporary files"
	@echo "  help        Show this help message"

## setup: Install all dependencies (Astro UI, etc.)
setup:
	@echo "Installing dependencies for Astro UI in $(UI_DIR)..."
	npm install --prefix $(UI_DIR)

## dev: Start Astro development server
dev:
	@echo "Starting development server..."
	npm run dev --prefix $(UI_DIR)

## build: Build Astro UI for production
build:
	@echo "Building Astro UI for production..."
	npm run build --prefix $(UI_DIR)

## preview: Preview production build locally
preview:
	@echo "Previewing production build..."
	npm run preview --prefix $(UI_DIR)

## clean: Remove build artifacts and node_modules
clean:
	@echo "Cleaning build artifacts and dependencies..."
	rm -rf $(UI_DIR)/dist
	rm -rf $(UI_DIR)/.astro
	rm -rf $(UI_DIR)/node_modules
	rm -rf node_modules
