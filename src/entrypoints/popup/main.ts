import { mount } from 'svelte';
import '@/components/base.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
