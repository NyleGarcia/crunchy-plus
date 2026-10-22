import { mount } from 'svelte';
import '@/app.css';
import Hub from './Hub.svelte';

mount(Hub, { target: document.getElementById('app')! });
